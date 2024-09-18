import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  HeadObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { sanitizeFileName } from "@/utils/security";
import { logger } from "@/utils/monitor";

export class CloudflareR2Service {
  private s3Client: S3Client;
  private bucketName: string;
  private publicUrlBase: string;

  constructor() {
    this.s3Client = new S3Client({
      endpoint: process.env.CLOUDFLARE_R2_ENDPOINT,
      region: "auto",
      credentials: {
        accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
        secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
      },
    });
    this.bucketName = process.env.CLOUDFLARE_R2_BUCKET_NAME || "";
    this.publicUrlBase = process.env.CLOUDFLARE_R2_PUBLIC_URL || "";

    this.s3Client.middlewareStack.add(
      (next, context) => async (args) => {
        // @ts-ignore
        args.request.headers.Authorization = `Bearer ${process.env.CLOUDFLARE_AUTHENTICATE}`;
        return next(args);
      },
      {
        step: "build",
        name: "addBearerToken",
      }
    );
  }

  async uploadFile(
    file: Buffer | string,
    fileName: string,
    contentType: string
  ): Promise<{ fileKey: string; publicUrl: string }> {
    const fileKey = `${crypto.randomUUID()}-${sanitizeFileName(fileName)}`;

    let body: Buffer;
    if (typeof file === "string") {
      body = Buffer.from(file, "utf-8");
    } else {
      body = file;
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      Body: body,
      ContentType: contentType,
      ContentEncoding: "utf-8",
    });

    try {
      await this.s3Client.send(command);
      const publicUrl = `${this.publicUrlBase}/${fileKey}`;
      logger.info(`File uploaded successfully: ${publicUrl}`);
      return { fileKey, publicUrl };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      logger.error(`Error uploading file: ${errorMessage}`);
      throw new Error(`Failed to upload file: ${errorMessage}`);
    }
  }

  async getSignedDownloadUrl(
    fileKey: string,
    expiresIn: number = 3600
  ): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
      ResponseContentDisposition: `attachment; filename="${fileKey}"`,
      ResponseContentType: "application/octet-stream",
    });

    try {
      const signedUrl = await getSignedUrl(this.s3Client, command, {
        expiresIn,
      });
      logger.info(`Generated signed URL for file: ${fileKey}`);
      return signedUrl;
    } catch (error) {
      logger.error(`Error generating signed URL for file ${fileKey}:`, error);
      throw new Error(`Failed to generate signed URL: ${error}`);
    }
  }

  getPublicUrl(fileKey: string): string {
    return `${this.publicUrlBase}/${fileKey}`;
  }

  async verifyFile(
    fileKey: string
  ): Promise<{ exists: boolean; size?: number; contentType?: string }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: fileKey,
      });
      const response = await this.s3Client.send(command);
      return {
        exists: true,
        size: response.ContentLength,
        contentType: response.ContentType,
      };
    } catch (error) {
      logger.error(`Error verifying file ${fileKey}:`, error);
      return { exists: false };
    }
  }

  async listFiles(prefix?: string, maxKeys: number = 1000): Promise<string[]> {
    const command = new ListObjectsV2Command({
      Bucket: this.bucketName,
      Prefix: prefix,
      MaxKeys: maxKeys,
    });

    try {
      const response = await this.s3Client.send(command);
      return response.Contents?.map((item) => item.Key || "") || [];
    } catch (error) {
      logger.error("Error listing files:", error);
      throw error;
    }
  }

  async deleteFile(fileKey: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucketName,
      Key: fileKey,
    });

    try {
      await this.s3Client.send(command);
      logger.info(`File deleted successfully: ${fileKey}`);
    } catch (error) {
      logger.error(`Error deleting file: ${error}`);
      throw new Error(`Failed to delete file: ${error}`);
    }
  }
}

export const cloudflareR2Service = new CloudflareR2Service();
