import { Elysia, t } from "elysia";
import { authPlugin } from "@/middleware/authPlugin";
import { s3DatasetService } from "@/services/s3DatasetService";
import { logger } from "@/utils/monitor";
import prisma from "@/middleware/prismaclient";

export const datasetsRouter = new Elysia({ prefix: "/datasets" })
  .use(authPlugin)

  // Get dataset list
  .get("/", async ({ query }) => {
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

  // Create new dataset
  .post(
    "/",
    async ({ body, authenticatedUser }) => {
      try {
        const dataset = await prisma.dataset.create({
          data: {
            title: body.title,
            description: body.description,
            isPrivate: body.isPrivate,
            tags: body.tags,
            userWalletAddress: authenticatedUser.walletAddress,
          },
        });

        return dataset;
      } catch (error) {
        logger.error("Error creating dataset:", error);
        throw error;
      }
    },
    {
      body: t.Object({
        title: t.String(),
        description: t.Optional(t.String()),
        isPrivate: t.Boolean(),
        tags: t.Array(t.String()),
      }),
    }
  )

  // Get upload URLs for files
  .post(
    "/upload-urls",
    async ({ body, authenticatedUser }) => {
      try {
        const uploadUrls = await Promise.all(
          body.files.map(async (file: any) => {
            const { uploadUrl, storageKey } =
              await s3DatasetService.getUploadUrl(
                authenticatedUser.id,
                body.datasetName,
                file.name,
                body.isPrivate
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
        datasetName: t.String(),
        files: t.Array(
          t.Object({
            name: t.String(),
          })
        ),
        isPrivate: t.Optional(t.Boolean()),
      }),
    }
  )

  // Complete dataset upload
  .post(
    "/:id/complete",
    async ({ params, body, authenticatedUser }) => {
      try {
        const dataset = await prisma.dataset.update({
          where: { id: params.id },
          data: {
            files: {
              createMany: {
                data: body.files.map((file: any) => ({
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

  // Get dataset details
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

  // Get download URLs for dataset files
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

  // Search datasets
  .get("/search", async ({ query }) => {
    try {
      const search = query.q as string;
      const type = query.type as string;
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 10;

      const datasets = await prisma.dataset.findMany({
        where: {
          OR: [
            { title: { contains: search, mode: "insensitive" } },
            { description: { contains: search, mode: "insensitive" } },
            { tags: { hasSome: [search] } },
          ],
          ...(type && {
            files: { some: { contentType: { startsWith: type } } },
          }),
        },
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
      });

      return datasets;
    } catch (error) {
      logger.error("Error searching datasets:", error);
      throw error;
    }
  });

export default datasetsRouter;
