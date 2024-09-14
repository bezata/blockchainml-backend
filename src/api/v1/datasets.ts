import { Elysia, t } from "elysia";
import { PrismaClient, Prisma } from "@prisma/client";
import { storjService } from "../../services/storj";

const prisma = new PrismaClient();

interface User {
  id: string;
  apiKey: string;
}

interface QueryParams {
  page?: string;
  limit?: string;
  sortBy?: "title" | "createdAt" | "downloads";
  sortOrder?: "asc" | "desc";
  tag?: string;
  search?: string;
}

interface Body {
  title: string;
  description?: string;
  tags: string[];
}

export const datasetsRouter = new Elysia({ prefix: "/datasets" })
  .get("/", async ({ query, user }: { query: QueryParams; user: User }) => {
    const page = Number(query.page) || 1;
    const limit = Number(query.limit) || 10;
    const skip = (page - 1) * limit;
    const sortBy = query.sortBy || "createdAt";
    const sortOrder = query.sortOrder || "desc";
    const tag = query.tag;
    const search = query.search;

    const where: Prisma.DatasetWhereInput = {
      userId: user.id,
      ...(tag && { tags: { has: tag } }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: "insensitive" } },
          { description: { contains: search, mode: "insensitive" } },
        ],
      }),
    };

    const [datasets, total] = await Promise.all([
      prisma.dataset.findMany({
        where,
        skip,
        take: limit,
        orderBy: { [sortBy]: sortOrder },
      }),
      prisma.dataset.count({ where }),
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
  })
  .post(
    "/",
    async ({ body, user }: { user: User; body: Body }) => {
      const { title, description, tags } = body;
      const uploadUrl = await storjService.getUploadUrl(
        `${user.id}/${title}`,
        3600
      );
      const dataset = await prisma.dataset.create({
        data: {
          title,
          description,
          fileUrl: `${user.id}/${title}`,
          user: { connect: { id: user.id } },
          tags,
        },
      });
      return { ...dataset, uploadUrl };
    },
    {
      body: t.Object({
        title: t.String(),
        description: t.Optional(t.String()),
        tags: t.Array(t.String()),
      }),
    }
  )
  .get(
    "/:id",
    async ({ params, user }: { user: User; params: { id: string } }) => {
      const dataset = await prisma.dataset.findUnique({
        where: { id: params.id, userId: user.id },
      });
      if (!dataset) {
        throw new Error("Dataset not found");
      }
      return dataset;
    }
  )
  .get(
    "/:id/download",
    async ({ params, user }: { user: User; params: { id: string } }) => {
      const dataset = await prisma.dataset.findUnique({
        where: { id: params.id, userId: user.id },
      });
      if (!dataset) {
        throw new Error("Dataset not found");
      }
      const downloadUrl = await storjService.getDownloadUrl(dataset.fileUrl);
      return { downloadUrl };
    }
  );
