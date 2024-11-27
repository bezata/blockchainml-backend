import { Elysia } from "elysia";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import dotenv from "dotenv";
import { opentelemetry } from "@elysiajs/opentelemetry";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import { PrismaClient } from "@prisma/client";
import { datasetsRouter } from "./api/v1/datasets/datasets";
import { trendingRouter } from "./api/v1/social/trending";
import { usersRouter } from "./api/v1/users/users";
import { authRouter } from "./api/v1//auth/auth";
import { userSettingsRouter } from "./api/v1/users/userSettings";
import { errorHandler, AppError } from "./utils/errorHandler";
import { logger, loggerPlugin, maskSensitiveData } from "./utils/monitor";
import { userProfileRouter } from "./api/v1/users/userProfile";
import { authPlugin } from "./middleware/authPlugin";
import os from "os";
import { publicOrganizationRouter } from "./api/v1/organization/organization";
import { organizationSettingsRouter } from "./api/v1/organization/organizationSettings";
import { userNotificationsRouter } from "./api/v1/users/notifications";
import messagingRouter from "./api/v1/messaging/conversations";

dotenv.config();

const prisma = new PrismaClient();

// Define store type for performance tracking
type StoreType = {
  routePerf?: {
    end: () => number;
  };
};

// Performance monitoring helper
export const createPerformanceTracker = (label: string) => {
  const start = process.hrtime();
  return {
    end: () => {
      const diff = process.hrtime(start);
      return (diff[0] * 1e9 + diff[1]) / 1e6; // Convert to milliseconds
    },
  };
};

async function connectPrisma() {
  const perf = createPerformanceTracker("prisma-connection");

  logger.info("Initiating Prisma connection", {
    databaseUrl: maskSensitiveData({
      url: process.env.DATABASE_URL,
    }).url,
    nodeEnv: process.env.NODE_ENV,
  });

  try {
    await prisma.$connect();
    const duration = perf.end();

    logger.info("Successfully connected to Prisma", {
      duration,
      connectionStatus: "connected",
    });

    try {
      await prisma.user.findFirst({
        select: { id: true },
        take: 1,
      });

      logger.info("Database connection verified", {
        connectionCheck: "successful",
        timestamp: new Date().toISOString(),
      });
    } catch (dbError) {
      logger.error("Database connection check failed", {
        error:
          dbError instanceof Error
            ? {
                name: dbError.name,
                message: dbError.message,
                code: (dbError as any).code,
                meta: (dbError as any).meta,
              }
            : dbError,
        timestamp: new Date().toISOString(),
      });
    }
  } catch (error) {
    const duration = perf.end();
    logger.error("Failed to connect to Prisma", {
      duration,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
              code: (error as any).code,
              meta: (error as any).meta,
            }
          : error,
      timestamp: new Date().toISOString(),
    });
    process.exit(1);
  }
}

async function startServer() {
  const serverStartTime = createPerformanceTracker("server-startup");

  logger.info("Starting server initialization", {
    environment: process.env.NODE_ENV,
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    memory: {
      total: os.totalmem(),
      free: os.freemem(),
    },
    cpu: os.cpus().length,
  });

  await connectPrisma();

  const app = new Elysia()
    .use(cors())
    .use(loggerPlugin)
    .use(
      opentelemetry({
        serviceName: "blockchainml-api",
        instrumentations: [getNodeAutoInstrumentations()],
      })
    )
    .use(swagger())
    .use(errorHandler)
    .decorate("store", {} as StoreType)
    .derive(({ store }) => {
      const perf = createPerformanceTracker("request-handling");
      store.routePerf = perf;
      return {};
    })
    .use((app) =>
      app.onRequest(({ request, store }) => {
        const requestLogger = (store as any)?.requestLogger || logger;

        requestLogger.info("Incoming request", {
          method: request.method,
          url: request.url,
          headers: maskSensitiveData({
            userAgent: request.headers.get("user-agent"),
            contentType: request.headers.get("content-type"),
            authorization: request.headers.get("authorization")
              ? "Bearer [MASKED]"
              : null,
          }),
          timestamp: new Date().toISOString(),
        });
      })
    )
    .onAfterHandle(({ store }) => {
      const duration = store.routePerf?.end();
      const requestLogger = (store as any)?.requestLogger || logger;

      if (duration) {
        requestLogger.info("Request completed", { duration });
      }
    })
    .get("/", () => {
      logger.info("Health check endpoint accessed");
      return "Welcome to BlockchainML API";
    })
    .group("/api/v1", (app) =>
      app
        .use(authRouter)
        .group("/user-settings", (app) =>
          app.use(authPlugin).use(userSettingsRouter)
        )
        .group("", (app) => app.use(authPlugin).use(userProfileRouter))
        .use(usersRouter)
        .use(datasetsRouter)
        .use(trendingRouter)
        .use(publicOrganizationRouter)
        .use(organizationSettingsRouter)
        .use(userNotificationsRouter)
        .use(messagingRouter)
    )
    .onError(({ code, error, request, store }) => {
      const errorLogger = (store as any)?.requestLogger || logger;
      const duration = store.routePerf?.end();

      errorLogger.error(`Error handling request: ${code}`, {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        request: {
          method: request.method,
          url: request.url,
          headers: maskSensitiveData({
            userAgent: request.headers.get("user-agent"),
            contentType: request.headers.get("content-type"),
          }),
        },
        duration,
      });

      if (error instanceof AppError) {
        return { error: error.message, status: error.statusCode };
      }
      return { error: "An unexpected error occurred", status: 500 };
    })
    .listen(process.env.PORT || 4000);

  const startupDuration = serverStartTime.end();
  logger.info("Server successfully started", {
    host: app.server?.hostname,
    port: app.server?.port,
    duration: startupDuration,
    routes: app.routes.map((route) => ({
      method: route.method,
      path: route.path,
    })),
  });

  return app;
}

// Start server with comprehensive error handling
startServer().catch((error) => {
  logger.error("Critical error during server startup", {
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
    context: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
      },
    },
  });
  process.exit(1);
});

// Graceful shutdown handling
const shutdown = async (signal: string) => {
  const shutdownPerf = createPerformanceTracker("graceful-shutdown");

  logger.info(`Received ${signal}, starting graceful shutdown`);

  try {
    await prisma.$disconnect();
    const duration = shutdownPerf.end();

    logger.info("Graceful shutdown completed", {
      signal,
      duration,
    });

    process.exit(0);
  } catch (error) {
    const duration = shutdownPerf.end();
    logger.error("Error during graceful shutdown", {
      signal,
      duration,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    });
    process.exit(1);
  }
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

// Uncaught exception handling
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception", {
    error: {
      name: error.name,
      message: error.message,
      stack: error.stack,
    },
    context: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
      },
    },
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection", {
    reason:
      reason instanceof Error
        ? {
            name: reason.name,
            message: reason.message,
            stack: reason.stack,
          }
        : reason,
    context: {
      nodeVersion: process.version,
      platform: process.platform,
      memory: {
        total: os.totalmem(),
        free: os.freemem(),
      },
    },
  });
  process.exit(1);
});
