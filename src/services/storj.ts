import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { FileValidationService } from "./fileValidation";

export class StorjService {
  private s3Client: S3Client;
  private bucketName: string;

  constructor() {
    this.s3Client = new S3Client({
      endpoint: process.env.STORJ_ENDPOINT,
      credentials: {
        accessKeyId: process.env.STORJ_ACCESS_KEY_ID!,
        secretAccessKey: process.env.STORJ_SECRET_ACCESS_KEY!,
      },
      region: "us-east-1",
    });
    this.bucketName = process.env.STORJ_BUCKET_NAME || "";
  }

  async getUploadUrl(fileName: string, fileSize: number): Promise<string> {
    const validationResult = FileValidationService.validateFile(
      fileName,
      fileSize
    );
    if (!validationResult.valid) {
      throw new Error(validationResult.error);
    }

    const command = new PutObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }

  async getDownloadUrl(fileName: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.bucketName,
      Key: fileName,
    });

    return await getSignedUrl(this.s3Client, command, { expiresIn: 3600 });
  }
}

export const storjService = new StorjService();
