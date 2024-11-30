import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "../utils/monitor";
import crypto from "crypto";
import path from "path";
import { createWriteStream } from "fs";
import { setTimeout } from "timers/promises";
import pLimit from "p-limit";
import { Readable, Writable } from "stream";
import { createReadStream } from "fs";
import { PrismaClient, Dataset, Prisma } from "@prisma/client";
import * as fs from "fs";

class DatasetError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

interface RetryOptions {
  maxRetries: number;
  initialDelay: number;
  maxDelay: number;
}

interface CreateDatasetInput {
  title: string;
  description?: string;
  tags: string[];
  isPublic: boolean;
  isPrivate: boolean;
  userWalletAddress?: string;
  files?: {
    name: string;
    storageKey: string;
    size: number;
    contentType: string;
  }[];
}

interface ProgressCallback {
  onProgress: (progress: number) => void;
}

const prisma = new PrismaClient();

export class S3DatasetService {
  private s3Client: S3Client;
  private bucket: string;
  private concurrencyLimit: number;
  private retryOptions: RetryOptions;
  private limiter: any; // p-limit instance
  private urlCache = new Map<string, { url: string; expires: number }>();
  private readonly MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB

  // Supported file types and their folders
  private readonly FILE_TYPES = {
    TEXT: {
      extensions: [".csv", ".json", ".jsonl", ".txt", ".tsv"],
      folder: "text",
      tracked: false, 
    },
    AUDIO: {
      extensions: [".mp3", ".wav", ".flac", ".m4a"],
      folder: "audio",
      tracked: true, 
    },
    IMAGE: {
      extensions: [".jpg", ".jpeg", ".png", ".gif", ".webp"],
      folder: "image",
      tracked: true,
    },
    ARCHIVE: {
      extensions: [".zip", ".gz", ".tar", ".7z"],
      folder: "compressed",
      tracked: true,
    },
    VIDEO: {
      extensions: [".mp4", ".avi", ".mov", ".mkv"],
      folder: "video",
      tracked: true,
    },
    BINARY: {
      extensions: [".bin", ".parquet", ".arrow"],
      folder: "binary",
      tracked: true,
    },
  };

  constructor(
    options = {
      maxConcurrency: 5,
      retryOptions: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 10000,
      },
    }
  ) {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || "eu-west-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
      maxAttempts: 3, // Built-in AWS SDK retry
    });
    this.bucket = process.env.AWS_DATASET_BUCKET!;
    this.concurrencyLimit = options.maxConcurrency;
    this.retryOptions = options.retryOptions;
    this.limiter = pLimit(this.concurrencyLimit);
  }

  private async withRetry<T>(
    operation: () => Promise<T>,
    context: string
  ): Promise<T> {
    let lastError;
    let delay = this.retryOptions.initialDelay;

    for (let attempt = 1; attempt <= this.retryOptions.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        logger.warn(`${context} failed (attempt ${attempt})`, { error });

        if (attempt < this.retryOptions.maxRetries) {
          await setTimeout(delay);
          delay = Math.min(delay * 2, this.retryOptions.maxDelay);
        }
      }
    }

    throw lastError;
  }

  async getUploadUrl(
    userId: string,
    datasetName: string,
    filename: string,
    isPrivate: boolean = false
  ): Promise<{
    uploadUrl: string;
    storageKey: string;
    shouldTrackWithGitLFS: boolean;
    uploadId?: string;
  }> {
    return this.withRetry(async () => {
      const fileType = this.getFileType(filename);
      const storageKey = this.generateStorageKey(
        userId,
        datasetName,
        filename,
        isPrivate
      );

      const command = new PutObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
        ContentType: this.getContentType(filename),
        Metadata: {
          "dataset-name": datasetName,
          "user-id": userId,
          "file-type": fileType.folder,
          private: String(isPrivate),
        },
      });

      const uploadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600,
      });

      logger.info("Generated upload URL", {
        userId,
        datasetName,
        filename,
        storageKey,
        fileType: fileType.folder,
        isPrivate,
      });

      return {
        uploadUrl,
        storageKey,
        shouldTrackWithGitLFS: fileType.tracked,
      };
    }, "Get upload URL");
  }

  async uploadLargeFile(
    filePath: string,
    storageKey: string,
    options = { chunkSize: 5 * 1024 * 1024 },
    progressCallback?: ProgressCallback
  ): Promise<void> {
    try {
      return this.withRetry(async () => {
        const stream = createReadStream(filePath, {
          highWaterMark: options.chunkSize,
        });
        const chunks: Buffer[] = [];
        let totalUploaded = 0;
        const fileSize = (await fs.promises.stat(filePath)).size;

        // Process stream in chunks to manage memory
        for await (const chunk of stream) {
          chunks.push(chunk);
          totalUploaded += chunk.length;

          // When we have enough chunks, upload them concurrently
          if (chunks.length >= this.concurrencyLimit) {
            await this.uploadChunks(chunks, storageKey);
            chunks.length = 0; // Clear array while maintaining allocated memory

            // Report progress
            if (progressCallback) {
              progressCallback.onProgress((totalUploaded / fileSize) * 100);
            }
          }
        }

        // Upload any remaining chunks
        if (chunks.length > 0) {
          await this.uploadChunks(chunks, storageKey);

          // Final progress update
          if (progressCallback) {
            progressCallback.onProgress(100);
          }
        }
      }, "Upload large file");
    } catch (error) {
      // Clean up any uploaded chunks on failure
      await this.cleanupFailedUpload(storageKey);
      throw error;
    }
  }

  private async cleanupFailedUpload(
    storageKey: string,
    retryAttempts = 3
  ): Promise<void> {
    for (let attempt = 1; attempt <= retryAttempts; attempt++) {
      try {
        const command = new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: storageKey,
        });
        const response = await this.s3Client.send(command);
        const objects = response.Contents || [];

        if (objects.length > 0) {
          await Promise.all(
            objects.map((obj) =>
              this.s3Client.send(
                new DeleteObjectCommand({
                  Bucket: this.bucket,
                  Key: obj.Key!,
                })
              )
            )
          );
          return;
        }
      } catch (error) {
        if (attempt === retryAttempts) {
          logger.error("Failed to cleanup upload after all attempts", {
            error,
            storageKey,
            attempts: attempt,
          });
        } else {
          await setTimeout(Math.pow(2, attempt) * 1000);
        }
      }
    }
  }

  async getDownloadUrl(
    storageKey: string,
    userToken?: string
  ): Promise<string> {
    const cacheKey = `${storageKey}-${userToken || "public"}`;
    const cached = this.urlCache.get(cacheKey);

    if (cached && cached.expires > Date.now()) {
      return cached.url;
    }

    if (storageKey.includes("/private/") && !userToken) {
      throw new DatasetError(
        403,
        "Authentication required for private dataset"
      );
    }

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const url = await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });

    this.urlCache.set(cacheKey, {
      url,
      expires: Date.now() + 3500 * 1000,
    });

    return url;
  }

  async listDatasetFiles(
    userId: string,
    datasetName: string,
    isPrivate: boolean = false,
    search?: string
  ): Promise<
    Record<string, Array<{ name: string; size: number; lastModified: Date }>>
  > {
    // Input validation
    if (search && search.length < 2) {
      throw new DatasetError(400, "Search term must be at least 2 characters");
    }

    try {
      await this.checkDatasetAccess(datasetName, userId);
      const visibility = isPrivate ? "private" : "public";
      const prefix = `datasets/${visibility}/${userId}/${datasetName}/`;

      const command = new ListObjectsV2Command({
        Bucket: this.bucket,
        Prefix: prefix,
      });

      const response = await this.s3Client.send(command);
      const files = response.Contents || [];

      // Group files by type
      const groupedFiles = files.reduce((acc, file) => {
        const key = file.Key!;
        const typeFolder = key.split("/")[5]; // Get folder type from path
        const filename = path.basename(key);

        if (!acc[typeFolder]) {
          acc[typeFolder] = [];
        }

        acc[typeFolder].push({
          name: filename,
          size: file.Size!,
          lastModified: file.LastModified!,
        });

        return acc;
      }, {} as Record<string, any>);

      logger.info("Listed dataset files", {
        userId,
        datasetName,
        isPrivate,
        fileCount: files.length,
        types: Object.keys(groupedFiles),
      });

      return groupedFiles;
    } catch (error) {
      if (error instanceof DatasetError) throw error;
      logger.error("Error listing dataset files", {
        error,
        userId,
        datasetName,
      });
      throw new DatasetError(500, "Failed to list dataset files");
    }
  }

  private async checkDatasetAccess(
    datasetName: string,
    userId: string
  ): Promise<void> {
    const dataset = await prisma.dataset.findUnique({
      where: { id: datasetName },
    });

    if (!dataset) {
      throw new DatasetError(404, "Dataset not found");
    }

    if (
      dataset.accessibility !== "PUBLIC" &&
      dataset.userWalletAddress !== userId
    ) {
      throw new DatasetError(403, "Access denied to private dataset");
    }
  }

  async createDataset(
    data: CreateDatasetInput,
    userId: string
  ): Promise<Dataset> {
    try {
      return await prisma.$transaction(async (tx) => {
        const dataset = await tx.dataset.create({
          data: {
            ...data,
            userWalletAddress: userId,
            files: data.files
              ? {
                  create: data.files.map((file) => ({
                    name: file.name,
                    storageKey: file.storageKey,
                    size: file.size,
                    contentType: file.contentType,
                  })),
                }
              : undefined,
          },
        });

        await tx.activity.create({
          data: {
            type: "DATASET_CREATED",
            datasetId: dataset.id,
            userId,
          },
        });

        return dataset;
      });
    } catch (error) {
      logger.error("Error creating dataset", { error, userId });
      throw new DatasetError(500, "Failed to create dataset");
    }
  }

  private async uploadChunks(
    chunks: Buffer[],
    storageKey: string
  ): Promise<void> {
    const uploadPromises = chunks.map((chunk, index) =>
      this.limiter(() =>
        this.withRetry(async () => {
          const command = new PutObjectCommand({
            Bucket: this.bucket,
            Key: `${storageKey}/chunk-${index}`,
            Body: chunk,
          });
          await this.s3Client.send(command);
        }, `Upload chunk ${index}`)
      )
    );

    await Promise.all(uploadPromises);
  }

  async downloadLargeFile(
    storageKey: string,
    writableStream: Writable,
    options = { chunkSize: 5 * 1024 * 1024 }
  ): Promise<void> {
    return this.withRetry(async () => {
      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });

      const response = await this.s3Client.send(command);
      const bodyStream = response.Body as Readable;

      // Set up pipeline with backpressure handling
      await new Promise((resolve, reject) => {
        bodyStream
          .pipe(writableStream)
          .on("error", reject)
          .on("finish", resolve);
      });
    }, "Download large file");
  }

  async downloadConcurrent(
    storageKeys: string[],
    outputDirectory: string
  ): Promise<void> {
    const downloadPromises = storageKeys.map((key) =>
      this.limiter(() =>
        this.withRetry(async () => {
          const outputPath = path.join(outputDirectory, path.basename(key));
          const writeStream = createWriteStream(outputPath);
          await this.downloadLargeFile(key, writeStream);
        }, `Download file ${key}`)
      )
    );

    await Promise.all(downloadPromises);
  }

  private getContentType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const contentTypes: Record<string, string> = {
      // Text
      ".csv": "text/csv",
      ".json": "application/json",
      ".jsonl": "application/x-jsonlines",
      ".txt": "text/plain",
      ".tsv": "text/tab-separated-values",
      // Audio
      ".mp3": "audio/mpeg",
      ".wav": "audio/wav",
      ".flac": "audio/flac",
      ".m4a": "audio/mp4",
      // Image
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      // Archive
      ".zip": "application/zip",
      ".gz": "application/gzip",
      ".tar": "application/x-tar",
      ".7z": "application/x-7z-compressed",
      // Video
      ".mp4": "video/mp4",
      ".avi": "video/x-msvideo",
      ".mov": "video/quicktime",
      ".mkv": "video/x-matroska",
      // Binary
      ".parquet": "application/parquet",
      ".arrow": "application/arrow",
      ".bin": "application/octet-stream",
    };

    return contentTypes[ext] || "application/octet-stream";
  }

  private getFileType(filename: string) {
    const ext = path.extname(filename).toLowerCase();
    for (const type of Object.values(this.FILE_TYPES)) {
      if (type.extensions.includes(ext)) {
        return type;
      }
    }
    return this.FILE_TYPES.BINARY; // Default to binary if no match
  }

  private generateStorageKey(
    userId: string,
    datasetName: string,
    filename: string,
    isPrivate: boolean
  ): string {
    const visibility = isPrivate ? "private" : "public";
    const fileType = this.getFileType(filename);
    return `datasets/${visibility}/${userId}/${datasetName}/${fileType.folder}/${filename}`;
  }

  private validateFile(filename: string, size: number): void {
    if (size > this.MAX_FILE_SIZE) {
      throw new DatasetError(400, `File size exceeds maximum limit of 5GB`);
    }

    const ext = path.extname(filename).toLowerCase();
    const validTypes = Object.values(this.FILE_TYPES).flatMap(
      (type) => type.extensions
    );

    if (!validTypes.includes(ext)) {
      throw new DatasetError(400, `File type ${ext} is not supported`);
    }
  }

  async validateChecksum(
    storageKey: string,
    expectedHash: string
  ): Promise<boolean> {
    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: storageKey,
    });

    const response = await this.s3Client.send(command);
    const stream = response.Body as Readable;
    const hash = crypto.createHash("sha256");

    await new Promise((resolve, reject) => {
      stream.on("data", (chunk) => hash.update(chunk));
      stream.on("end", resolve);
      stream.on("error", reject);
    });

    return hash.digest("hex") === expectedHash;
  }

  async batchUpload(
    files: Array<{ path: string; name: string }>,
    userId: string,
    datasetName: string,
    options: { maxConcurrent?: number; onProgress?: (progress: number) => void }
  ): Promise<
    Array<{ success: boolean; file: string; storageKey?: string; error?: any }>
  > {
    const total = files.length;
    let completed = 0;

    const results = await Promise.all(
      files.map(async (file) => {
        try {
          const { uploadUrl, storageKey } = await this.getUploadUrl(
            userId,
            datasetName,
            file.name
          );
          await this.uploadLargeFile(file.path, storageKey);

          completed++;
          if (options.onProgress) {
            options.onProgress((completed / total) * 100);
          }

          return { success: true, file: file.name, storageKey };
        } catch (error) {
          return { success: false, file: file.name, error };
        }
      })
    );

    return results;
  }
}

export const s3DatasetService = new S3DatasetService();
