import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import dotenv from "dotenv";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrismaClient } from "@prisma/client";
import { datasetsRouter } from "./api/v1/datasets";
import { trendingRouter } from "./api/v1/trending";
import { usersRouter } from "./api/v1/users";
import { authRouter } from "./api/v1/auth";
import { userSettingsRouter } from "./api/v1/userSettings";
import { errorHandler, AppError } from "./utils/errorHandler";
import { logger } from "./utils/monitor";
import { userProfileRouter } from "./api/v1/userProfileRoutes";
import { authPlugin } from "./middleware/authPlugin";

dotenv.config();

const prisma = new PrismaClient();

async function connectPrisma() {
  try {
    await prisma.$connect();
    logger.info("Successfully connected to Prisma");
  } catch (error) {
    logger.error("Failed to connect to Prisma:", error);
    process.exit(1);
  }
}

async function startServer() {
  await connectPrisma();

  const app = new Elysia()
    .use(cors())
    .use(
      opentelemetry({
        serviceName: "blockchainml-api",
        instrumentations: [getNodeAutoInstrumentations()],
      })
    )
    .use(swagger())
    .use(errorHandler)
    .use((app) =>
      app.onRequest((context) => {
        logger.info(
          `Incoming request: ${context.request.method} ${context.request.url}`
        );
      })
    )
    .get("/", () => "Welcome to BlockchainML API")
    .group("/api/v1", (app) =>
      app
        .use(authRouter)
        .group("/user-settings", (app) =>
          app.use(authPlugin).use(userSettingsRouter)
        )
        .group("/user", (app) => app.use(authPlugin).use(userProfileRouter))
        .use(usersRouter)
        .use(datasetsRouter)
        .use(trendingRouter)
    )
    .onError(({ code, error }) => {
      logger.error(`Unhandled error: ${code}`, {
        error: error.message,
        stack: error.stack,
      });
      if (error instanceof AppError) {
        return { error: error.message, status: error.statusCode };
      }
      return { error: "An unexpected error occurred", status: 500 };
    })
    .listen(process.env.PORT || 4000);

  logger.info(
    `🦊 Elysia is running at ${app.server?.hostname}:${app.server?.port}`
  );

  return app;
}

startServer().catch((error) => {
  logger.error("Failed to start server:", error);
  process.exit(1);
});

// Graceful shutdown
process.on("SIGINT", async () => {
  await prisma.$disconnect();
  process.exit(0);
});
