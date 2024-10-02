import { Elysia, t } from "elysia";
import { PrismaClient } from "@prisma/client";
import { AppError } from "@/utils/errorHandler";
import { logger } from "@/utils/monitor";

const prisma = new PrismaClient();

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
  try {
    const dataset = await prisma.dataset.create({
      data: body,
    });
    logger.info(`Created dataset: ${dataset.id}`);
    return dataset;
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

export default datasetsRouter;