import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { PrismaClient } from "@prisma/client";
import dotenv from "dotenv";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { datasetsRouter } from "./api/v1/datasets";
import { trendingRouter } from "./api/v1/trending";
import { usersRouter } from "./api/v1/users";
import { authMiddleware } from "./middleware/auth";
import { errorHandler, AppError } from "./utils/errorHandler";
import { logger } from "./utils/monitor";
import { sanitizeInput } from "./utils/security";
import { rateLimiter } from "./utils/rateLimit";

dotenv.config();

const prisma = new PrismaClient();

const corsConfig = cors({
  origin: (process.env.ALLOWED_ORIGINS || "").split(","),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

const sanitizationMiddleware = new Elysia().onRequest((context) => {
  if ("body" in context) {
    context.set.body = sanitizeInput(context.body as any);
  }
  if (context.params) {
    context.set.params = sanitizeInput(context.params);
  }
  if (context.query) {
    context.set.query = sanitizeInput(context.query);
  }
});

export const app = new Elysia()
  .use(
    opentelemetry({
      serviceName: "blockchainml-api",
      instrumentations: [getNodeAutoInstrumentations()],
    })
  )
  .use(swagger())
  .use(corsConfig)
  .use(rateLimiter)
  .use(sanitizationMiddleware as any)
  .use(errorHandler)
  .get("/", () => "Welcome to BlockchainML API")
  .group("/api/v1", (app: Elysia) =>
    app
      .use(usersRouter)
      .group("/auth", (app) =>
        app.use(authMiddleware).use(datasetsRouter).use(trendingRouter)
      )
  )
  .listen(process.env.PORT || 3000);

logger.info(
  `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
);

process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});