import { Elysia, t } from "elysia";
import { PrismaClient } from "@prisma/client";
import { CloudflareR2Service } from "@/services/cloudflareR2Service";
import { AppError } from "@/utils/errorHandler";
import { logger } from "@/utils/monitor";

const prisma = new PrismaClient();
const cloudflareR2Service = new CloudflareR2Service();

// Helper functions
const handleError = (message: string, error: any, statusCode: number = 500) => {
  logger.error(message, error);
  throw error instanceof AppError ? error : new AppError(message, statusCode);
};

const getPaginationParams = (query: any) => ({
  page: parseInt(query.page || "1"),
  limit: parseInt(query.limit || "10"),
  sortBy: query.sortBy || "createdAt",
  sortOrder: query.sortOrder || "desc",
});

// Route handlers
const getDatasetsHandler = async ({ query }: { query: any }) => {
  const { page, limit, sortBy, sortOrder } = getPaginationParams(query);
  const skip = (page - 1) * limit;

  try {
    const [datasets, total] = await Promise.all([
      prisma.dataset.findMany({
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.dataset.count(),
    ]);

    return {
      datasets,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  } catch (error) {
    handleError("Failed to fetch datasets", error);
  }
};

const getDatasetHandler = async ({ params }: { params: { id: string } }) => {
  try {
    const dataset = await prisma.dataset.findUnique({
      where: { id: params.id },
    });
    if (!dataset) throw new AppError("Dataset not found", 404);
    return dataset;
  } catch (error) {
    handleError(`Error fetching dataset ${params.id}`, error);
  }
};

const createDatasetHandler = async ({ body }: { body: any }) => {
  const { title, description, tags, isPublic, file } = body;
  try {
    let fileContent: Buffer | string;
    let parsedData: any;

    // Parse the stringified data
    try {
      parsedData = JSON.parse(file.data);
    } catch (error) {
      throw new AppError("Invalid file data: Unable to parse JSON", 400);
    }

    switch (file.type) {
      case "application/json":
      case "application/vnd.croissant+json":
      case "text/csv":
        // For JSON, Croissant, and CSV, the data is already parsed
        fileContent = JSON.stringify(parsedData);
        break;
      case "application/x-parquet":
        // For Parquet, we receive base64 encoded data
        fileContent = Buffer.from(parsedData, "base64");
        break;
      default:
        // For other types, use base64 encoded data
        fileContent = Buffer.from(parsedData, "base64");
    }

    const { fileKey } = await cloudflareR2Service.uploadFile(
      fileContent,
      file.name,
      file.type
    );

    const dataset = await prisma.dataset.create({
      data: {
        title,
        description,
        tags,
        isPublic,
        // @ts-ignore
        fileKey, // Store the file key instead of the URL
        fileType: file.type,
      },
    });

    logger.info(
      `Created dataset: ${dataset.id}, File uploaded to Cloudflare R2: ${fileKey}`
    );
    return { dataset, fileKey };
  } catch (error) {
    handleError("Failed to create dataset", error);
  }
};

const updateDatasetHandler = async ({
  params,
  body,
}: {
  params: { id: string };
  body: any;
}) => {
  try {
    const updatedDataset = await prisma.dataset.update({
      where: { id: params.id },
      data: body,
    });
    logger.info(`Updated dataset ${params.id}`);
    return updatedDataset;
  } catch (error) {
    handleError(`Failed to update dataset ${params.id}`, error);
  }
};

const deleteDatasetHandler = async ({ params }: { params: { id: string } }) => {
  try {
    const dataset = await prisma.dataset.findUnique({
      where: { id: params.id },
    });
    if (!dataset) throw new AppError("Dataset not found", 404);

    if (dataset.fileUrl) {
      await cloudflareR2Service.deleteFile(dataset.fileUrl);
    }

    await prisma.dataset.delete({ where: { id: params.id } });
    logger.info(`Deleted dataset: ${params.id}`);
    return { message: "Dataset deleted successfully" };
  } catch (error) {
    handleError(`Failed to delete dataset ${params.id}`, error);
  }
};

// Router definition
export const datasetsRouter = new Elysia({ prefix: "/datasets" })
  .get("/", getDatasetsHandler)
  .get("/:id", getDatasetHandler)
  .post("/", createDatasetHandler, {
    body: t.Object({
      title: t.String(),
      description: t.Optional(t.String()),
      tags: t.Array(t.String()),
      isPublic: t.Boolean(),
      file: t.Object({
        name: t.String(),
        size: t.Number(),
        type: t.String(),
        data: t.String(), // Changed to t.String() as we're now sending stringified data
      }),
    }),
  })
  .patch("/:id", updateDatasetHandler, {
    body: t.Object({
      title: t.Optional(t.String()),
      description: t.Optional(t.String()),
      tags: t.Optional(t.Array(t.String())),
      isPublic: t.Optional(t.Boolean()),
    }),
  })
  .delete("/:id", deleteDatasetHandler);

datasetsRouter.get("/:id/download", async ({ params }) => {
  const dataset = await prisma.dataset.findUnique({
    where: { id: params.id },
  });

  if (!dataset) {
    throw new AppError("Dataset not found", 404);
  }
  // @ts-ignore
  if (!(dataset.fileKey as string)) {
    throw new AppError("Dataset file key is missing", 404);
  }

  try {
    const signedUrl = await cloudflareR2Service.getSignedDownloadUrl(
      // @ts-ignore
      dataset.fileKey
    );
    // @ts-ignore
    const publicUrl = cloudflareR2Service.getPublicUrl(dataset.fileKey);

    return {
      signedUrl,
      publicUrl,
      // @ts-ignore
      fileName: dataset.fileKey.split("/").pop(),
      // @ts-ignore
      fileType: dataset.fileType,
    };
  } catch (error) {
    logger.error(
      `Error generating download URLs for dataset ${params.id}:`,
      error
    );
    throw new AppError("Failed to generate download URLs", 500);
  }
});

datasetsRouter.get("/files", async ({ query }) => {
  try {
    const prefix = query.prefix as string | undefined;
    const maxKeys = query.maxKeys
      ? parseInt(query.maxKeys as string)
      : undefined;
    const files = await cloudflareR2Service.listFiles(prefix, maxKeys);
    return { files };
  } catch (error) {
    logger.error("Error listing files:", error);
    throw new AppError("Failed to list files", 500);
  }
});

export default datasetsRouter;