import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import dotenv from "dotenv";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { datasetsRouter } from "./api/v1/datasets";
import { trendingRouter } from "./api/v1/trending";
import { usersRouter } from "./api/v1/users";
import { errorHandler, AppError } from "./utils/errorHandler";
import { logger } from "./utils/monitor";

dotenv.config();

export const app = new Elysia()
  .use(
    opentelemetry({
      serviceName: "blockchainml-api",
      instrumentations: [getNodeAutoInstrumentations()],
    })
  )
  .use(swagger())
  .use(datasetsRouter)
  .use(cors())
  .use(errorHandler)
  .get("/", () => "Welcome to BlockchainML API")
  .group("/api/v1", (app) =>
    app.use(usersRouter).use(datasetsRouter).use(trendingRouter)
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