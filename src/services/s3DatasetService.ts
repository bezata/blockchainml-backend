import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { logger } from "../utils/monitor";
import crypto from "crypto";
import path from "path";

export class S3DatasetService {
  private s3Client: S3Client;
  private bucket: string;

  // Supported file types and their folders
  private readonly FILE_TYPES = {
    TEXT: {
      extensions: [".csv", ".json", ".jsonl", ".txt", ".tsv"],
      folder: "text",
      tracked: false, // Not tracked by Git LFS by default if < 10MB
    },
    AUDIO: {
      extensions: [".mp3", ".wav", ".flac", ".m4a"],
      folder: "audio",
      tracked: true, // Always tracked by Git LFS
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

  constructor() {
    this.s3Client = new S3Client({
      region: process.env.AWS_REGION || "eu-west-1",
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
      },
    });
    this.bucket = process.env.AWS_DATASET_BUCKET!;
  }

  private generateStorageKey(
    userId: string,
    datasetName: string,
    filename: string,
    isPrivate: boolean
  ): string {
    const hash = crypto
      .createHash("sha256")
      .update(`${userId}-${datasetName}-${Date.now()}`)
      .digest("hex")
      .slice(0, 8);

    const fileType = this.getFileType(filename);
    const visibility = isPrivate ? "private" : "public";

    return `datasets/${visibility}/${userId}/${datasetName}/${fileType.folder}/${hash}/${filename}`;
  }

  private getFileType(filename: string): { folder: string; tracked: boolean } {
    const ext = path.extname(filename).toLowerCase();

    for (const [type, info] of Object.entries(this.FILE_TYPES)) {
      if (info.extensions.includes(ext)) {
        return {
          folder: info.folder,
          tracked: info.tracked,
        };
      }
    }

    return {
      folder: "other",
      tracked: true,
    };
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
  }> {
    try {
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
    } catch (error) {
      logger.error("Error generating upload URL", {
        error,
        userId,
        datasetName,
        filename,
      });
      throw error;
    }
  }

  async getDownloadUrl(
    storageKey: string,
    userToken?: string
  ): Promise<string> {
    try {
      // Check if private dataset
      if (storageKey.includes("/private/") && !userToken) {
        throw new Error("Authentication required for private dataset");
      }

      const command = new GetObjectCommand({
        Bucket: this.bucket,
        Key: storageKey,
      });

      const downloadUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn: 3600,
      });

      logger.info("Generated download URL", {
        storageKey,
        isPrivate: storageKey.includes("/private/"),
      });

      return downloadUrl;
    } catch (error) {
      logger.error("Error generating download URL", { error, storageKey });
      throw error;
    }
  }

  async listDatasetFiles(
    userId: string,
    datasetName: string,
    isPrivate: boolean = false
  ): Promise<{
    [key: string]: Array<{
      name: string;
      size: number;
      lastModified: Date;
    }>;
  }> {
    try {
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
      logger.error("Error listing dataset files", {
        error,
        userId,
        datasetName,
      });
      throw error;
    }
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
}

export const s3DatasetService = new S3DatasetService();
