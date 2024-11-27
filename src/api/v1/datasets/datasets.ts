import { Elysia, t } from "elysia";
import { authPlugin } from "@/middleware/authPlugin";
import { s3DatasetService } from "@/services/s3DatasetService";
import { logger } from "@/utils/monitor";
import prisma from "@/middleware/prismaclient";
import { Prisma } from "@prisma/client";

interface AuthenticatedUser {
  id: string;
  walletAddress: string;
}

interface RequestParams {
  id: string;
}

interface SearchQuery {
  q?: string;
  type?: string;
  page?: string;
  limit?: string;
}

interface UploadUrlsBody {
  files: Array<{ name: string; size: number }>;
  datasetName: string;
  accessibility?: string;
}

interface CompleteUploadBody {
  files: Array<{
    name: string;
    storageKey: string;
    size: number;
    contentType: string;
  }>;
}

class DatasetError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "DatasetError";
  }
}

async function checkDatasetAccess(
  datasetId: string,
  userWalletAddress: string
) {
  const dataset = await prisma.dataset.findUnique({ where: { id: datasetId } });
  if (!dataset) throw new DatasetError(404, "Dataset not found");
  if (
    dataset.accessibility &&
    dataset.userWalletAddress !== userWalletAddress
  ) {
    throw new DatasetError(403, "Access denied");
  }
}

const createDatasetSchema = t.Object({
  title: t.String(),
  description: t.Optional(t.String()),
  accessibility: t.String(),
  tags: t.Array(t.String()),
});

const updateDatasetSchema = t.Object({
  title: t.Optional(t.String({ minLength: 1, maxLength: 100 })),
  description: t.Optional(t.String({ maxLength: 1000 })),
  tags: t.Optional(t.Array(t.String())),
  accessibility: t.Optional(t.String()),
});

export const datasetsRouter = new Elysia({ prefix: "/datasets" })
  .use(authPlugin)

  .get("/", async ({ query }: { query: { page?: string; limit?: string } }) => {
    try {
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 10;

      const datasets = await prisma.dataset.findMany({
        take: limit,
        skip: (page - 1) * limit,
        include: {
          user: {
            select: {
              name: true,
              walletAddress: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
      });

      const total = await prisma.dataset.count();

      return {
        datasets,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error fetching datasets:", error);
      throw error;
    }
  })

  .post(
    "/",
    async ({
      body,
      authenticatedUser,
    }: {
      body: typeof createDatasetSchema._type;
      authenticatedUser: AuthenticatedUser;
    }) => {
      return await prisma.$transaction(async (tx) => {
        const dataset = await tx.dataset.create({
          data: {
            title: body.title,
            description: body.description,
            accessibility: body.accessibility,
            tags: body.tags,
            userWalletAddress: authenticatedUser.walletAddress,
          },
        });

        await tx.activity.create({
          data: {
            type: "DATASET_CREATED",
            datasetId: dataset.id,
            userId: authenticatedUser.id,
          },
        });

        return dataset;
      });
    }
  )

  .post(
    "/upload-urls",
    async ({
      body,
      authenticatedUser,
    }: {
      body: UploadUrlsBody;
      authenticatedUser: AuthenticatedUser;
    }) => {
      const maxFileSize = 5 * 1024 * 1024 * 1024; // 5GB

      for (const file of body.files) {
        if (file.size > maxFileSize) {
          throw new DatasetError(
            400,
            `File ${file.name} exceeds maximum size of 5GB`
          );
        }
      }

      try {
        const uploadUrls = await Promise.all(
          body.files.map(async (file) => {
            const { uploadUrl, storageKey } =
              await s3DatasetService.getUploadUrl(
                authenticatedUser.id,
                body.datasetName,
                file.name,
                body.accessibility === "private"
              );

            return {
              fileName: file.name,
              uploadUrl,
              storageKey,
            };
          })
        );

        return { uploadUrls };
      } catch (error) {
        logger.error("Error generating upload URLs:", error);
        throw error;
      }
    },
    {
      body: t.Object({
        files: t.Array(
          t.Object({
            name: t.String(),
            size: t.Number(),
          })
        ),
        datasetName: t.String(),
        accessibility: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/:id/complete",
    async ({
      params,
      body,
      authenticatedUser,
    }: {
      params: RequestParams;
      body: CompleteUploadBody;
      authenticatedUser: AuthenticatedUser;
    }) => {
      try {
        const dataset = await prisma.dataset.update({
          where: { id: params.id },
          data: {
            files: {
              createMany: {
                data: body.files.map((file) => ({
                  name: file.name,
                  storageKey: file.storageKey,
                  size: file.size,
                  contentType: file.contentType,
                })),
              },
            },
          },
        });

        return dataset;
      } catch (error) {
        logger.error("Error completing dataset upload:", error);
        throw error;
      }
    },
    {
      body: t.Object({
        files: t.Array(
          t.Object({
            name: t.String(),
            storageKey: t.String(),
            size: t.Number(),
            contentType: t.String(),
          })
        ),
      }),
    }
  )

  .get("/:id", async ({ params, authenticatedUser }) => {
    try {
      const dataset = await prisma.dataset.findUnique({
        where: { id: params.id },
        include: {
          files: true,
          user: {
            select: {
              name: true,
              walletAddress: true,
            },
          },
        },
      });

      if (!dataset) {
        throw new Error("Dataset not found");
      }

      return dataset;
    } catch (error) {
      logger.error("Error fetching dataset:", error);
      throw error;
    }
  })

  .get("/:id/download", async ({ params, authenticatedUser }) => {
    try {
      const dataset = await prisma.dataset.findUnique({
        where: { id: params.id },
        include: { files: true },
      });

      if (!dataset) {
        throw new Error("Dataset not found");
      }

      const downloadUrls = await Promise.all(
        dataset.files.map(async (file) => ({
          fileName: file.name,
          downloadUrl: await s3DatasetService.getDownloadUrl(file.storageKey),
        }))
      );

      return { downloadUrls };
    } catch (error) {
      logger.error("Error generating download URLs:", error);
      throw error;
    }
  })

  .get("/search", async ({ query }: { query: SearchQuery }) => {
    try {
      const search = query.q || "";
      const type = query.type;
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 10;

      const where: Prisma.DatasetWhereInput = {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
          { tags: { hasSome: [search] } },
        ],
        ...(type && {
          files: { some: { contentType: { startsWith: type } } },
        }),
      };

      const [datasets, total] = await Promise.all([
        prisma.dataset.findMany({
          where,
          include: {
            user: {
              select: {
                name: true,
                walletAddress: true,
              },
            },
          },
          take: limit,
          skip: (page - 1) * limit,
        }),
        prisma.dataset.count({ where }),
      ]);

      return {
        datasets,
        pagination: {
          total,
          page,
          pages: Math.ceil(total / limit),
        },
      };
    } catch (error) {
      logger.error("Error searching datasets:", error);
      throw error;
    }
  })

  .delete(
    "/:id",
    async ({
      params,
      authenticatedUser,
    }: {
      params: RequestParams;
      authenticatedUser: AuthenticatedUser;
    }) => {
      await checkDatasetAccess(params.id, authenticatedUser.walletAddress);
      return prisma.$transaction([
        prisma.file.deleteMany({ where: { datasetId: params.id } }),
        prisma.dataset.delete({ where: { id: params.id } }),
      ]);
    }
  )

  .patch(
    "/:id",
    async ({
      params,
      body,
      authenticatedUser,
    }: {
      params: RequestParams;
      body: typeof updateDatasetSchema._type;
      authenticatedUser: AuthenticatedUser;
    }) => {
      await checkDatasetAccess(params.id, authenticatedUser.walletAddress);
      return prisma.dataset.update({
        where: { id: params.id },
        data: body,
      });
    },
    {
      body: updateDatasetSchema,
    }
  );

export default datasetsRouter;
