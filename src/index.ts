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
import { rateLimit } from "elysia-rate-limit";
import { authRouter, authMiddleware } from "./api/v1/auth";

dotenv.config();

export const app = new Elysia()
  .use(
    opentelemetry({
      serviceName: "blockchainml-api",
      instrumentations: [getNodeAutoInstrumentations()],
    })
  )
  .use(authMiddleware)
  .use(
    rateLimit({
      duration: 60000, // 1 minute
      max: 100, // 100 requests per minute
      generator: (req) => {
        return (
          req.headers.get("CF-Connecting-IP") ||
          req.headers.get("x-forwarded-for")?.split(",")[0] ||
          req.headers.get("x-real-ip") ||
          "unknown"
        );
      },
      errorResponse: new Response("Rate limit exceeded", { status: 429 }),
      countFailedRequest: true,
      skip: (request) => request.method === "OPTIONS", // Skip OPTIONS requests
      headers: true, // Include rate limit headers in response
    })
  )
  .use(swagger())
  .use(cors())
  .use(errorHandler)
  .get("/", () => "Welcome to BlockchainML API")
  .group("/api/v1", (app) =>
    app.use(usersRouter).use(datasetsRouter).use(trendingRouter).use(authRouter)
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