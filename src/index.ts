import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { websocket } from "@elysiajs/websocket";
import dotenv from "dotenv";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { datasetsRouter } from "./api/v1/datasets";
import { trendingRouter } from "./api/v1/trending";
import { usersRouter } from "./api/v1/users";
import { authRouter, authMiddleware } from "./api/v1/auth";
import { userSettingsRouter } from "./api/v1/userSettings";
import { forumRouter } from "./api/v1/forum";
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
  .use(authMiddleware)
  .use(swagger())
  .use(cors())
  .use(errorHandler)
  .use(websocket())
  .ws("/ws", {
    message(ws, message) {
      // Handle incoming WebSocket messages
      console.log("Received message:", message);
    },
  })
  .get("/", () => "Welcome to BlockchainML API")
  .group("/api/v1", (app) =>
    app
      .use(usersRouter)
      .use(datasetsRouter)
      .use(trendingRouter)
      .use(authRouter)
      .use(userSettingsRouter)
      .use(forumRouter)
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