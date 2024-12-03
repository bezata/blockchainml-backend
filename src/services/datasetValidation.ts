import { Elysia, t } from "elysia";
import { PrismaClient } from "@prisma/client";
import { logger } from "@/utils/monitor";

const prisma = new PrismaClient();

// Constants for validation
const MAX_TITLE_LENGTH = 100;
const MAX_DESCRIPTION_LENGTH = 1000;
const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 30;
const MAX_FILE_SIZE = 5 * 1024 * 1024 * 1024; // 5GB
const ALLOWED_FILE_EXTENSIONS = [
  // Text
  ".csv", ".json", ".jsonl", ".txt", ".tsv",
  // Audio
  ".mp3", ".wav", ".flac", ".m4a",
  // Image
  ".jpg", ".jpeg", ".png", ".gif", ".webp",
  // Archive
  ".zip", ".gz", ".tar", ".7z",
  // Video
  ".mp4", ".avi", ".mov", ".mkv",
  // Binary
  ".parquet", ".arrow", ".bin"
];

// Custom error class for validation errors
export class DatasetValidationError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = "DatasetValidationError";
  }
}

// Schema definitions
const fileSchema = t.Object({
  name: t.String({ minLength: 1, maxLength: 255 }),
  size: t.Number({ minimum: 0, maximum: MAX_FILE_SIZE }),
  contentType: t.String(),
  storageKey: t.Optional(t.String())
});

const datasetBaseSchema = t.Object({
  title: t.String({ minLength: 1, maxLength: MAX_TITLE_LENGTH }),
  description: t.Optional(t.String({ maxLength: MAX_DESCRIPTION_LENGTH })),
  tags: t.Array(t.String(), { maxItems: MAX_TAGS }),
  accessibility: t.String()
});

const createDatasetSchema = t.Object({
  ...datasetBaseSchema.properties,
  files: t.Array(fileSchema)
});

const updateDatasetSchema = t.Partial(datasetBaseSchema);

export const datasetValidationMiddleware = new Elysia({ name: 'dataset-validation' })
  .model({
    createDataset: createDatasetSchema,
    updateDataset: updateDatasetSchema,
    file: fileSchema
  })
  .derive(({ set }) => ({
    // Custom validator functions available in routes
    validateDatasetAccess: async (datasetId: string, userWalletAddress: string) => {
      const dataset = await prisma.dataset.findFirst({
        where: {
          id: datasetId,
          OR: [
            { userWalletAddress },
            { accessibility: "public" }
          ]
        }
      });

      if (!dataset) {
        set.status = 404;
        throw new DatasetValidationError(
          "DATASET_NOT_FOUND",
          "Dataset not found or access denied"
        );
      }

      return dataset;
    },

    validateFiles: (files: Array<{ name: string; size: number; contentType: string }>) => {
      const errors: Array<{ file: string; errors: string[] }> = [];

      files.forEach(file => {
        const fileErrors: string[] = [];
        const ext = file.name.substring(file.name.lastIndexOf(".")).toLowerCase();

        // Validate file extension
        if (!ALLOWED_FILE_EXTENSIONS.includes(ext)) {
          fileErrors.push(`File type ${ext} is not supported`);
        }

        // Validate file size
        if (file.size > MAX_FILE_SIZE) {
          fileErrors.push(`File size exceeds maximum limit of 5GB`);
        }

        // Validate file name
        if (!/^[\w\-. ]+$/.test(file.name)) {
          fileErrors.push("File name contains invalid characters");
        }

        if (fileErrors.length > 0) {
          errors.push({ file: file.name, errors: fileErrors });
        }
      });

      if (errors.length > 0) {
        throw new DatasetValidationError(
          "INVALID_FILES",
          "One or more files failed validation",
          errors
        );
      }
    },

    validateTags: (tags: string[]) => {
      const errors: string[] = [];

      if (tags.length > MAX_TAGS) {
        errors.push(`Maximum number of tags (${MAX_TAGS}) exceeded`);
      }

      tags.forEach(tag => {
        if (tag.length > MAX_TAG_LENGTH) {
          errors.push(`Tag '${tag}' exceeds maximum length of ${MAX_TAG_LENGTH}`);
        }
        if (!/^[\w\-]+$/.test(tag)) {
          errors.push(`Tag '${tag}' contains invalid characters`);
        }
      });

      if (errors.length > 0) {
        throw new DatasetValidationError(
          "INVALID_TAGS",
          "One or more tags failed validation",
          errors
        );
      }
    }
  }))
  .onError(({ error, set }) => {
    if (error instanceof DatasetValidationError) {
      set.status = 400;
      return {
        error: error.code,
        message: error.message,
        details: error.details
      };
    }

    logger.error("Unexpected validation error", { error });
    set.status = 500;
    return {
      error: "VALIDATION_ERROR",
      message: "An unexpected error occurred during validation"
    };
  });

// Type exports for use in other parts of the application
export type CreateDatasetSchema = typeof createDatasetSchema._type;
export type UpdateDatasetSchema = typeof updateDatasetSchema._type;
export type FileSchema = typeof fileSchema._type;