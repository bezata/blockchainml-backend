import winston from "winston";
import "winston-daily-rotate-file";
import path from "path";
import os from "os";
import { Elysia } from "elysia";
import { randomUUID } from "crypto";

// Custom log levels
const logLevels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6,
};

// Custom colors for each level
const logColors = {
  error: "red",
  warn: "yellow",
  info: "green",
  http: "magenta",
  verbose: "cyan",
  debug: "blue",
  silly: "gray",
};

// Add colors to Winston
winston.addColors(logColors);

// Create custom format for detailed logging
const detailedFormat = winston.format.combine(
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
  winston.format.errors({ stack: true }),
  winston.format.metadata({
    fillWith: ["timestamp", "service", "host", "pid", "requestId", "userId"],
  }),
  winston.format.json()
);

// Custom format for console output
const consoleFormat = winston.format.combine(
  winston.format.colorize({ all: true }),
  winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
  winston.format.printf(({ timestamp, level, message, metadata, stack }) => {
    let log = `${timestamp} [${level}]: ${message}`;
    if (metadata && Object.keys(metadata).length) {
      log += `\nMetadata: ${JSON.stringify(metadata, null, 2)}`;
    }
    if (stack) {
      log += `\nStack: ${stack}`;
    }
    return log;
  })
);

// Create the logger instance
export const logger = winston.createLogger({
  levels: logLevels,
  level: process.env.LOG_LEVEL || "info",
  defaultMeta: {
    service: process.env.SERVICE_NAME || "elysia-service",
    host: os.hostname(),
    pid: process.pid,
  },
  transports: [
    // Rotating File Transport for Errors
    new winston.transports.DailyRotateFile({
      filename: path.join("logs", "error-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      level: "error",
      format: detailedFormat,
      maxSize: "20m",
      maxFiles: "14d",
      zippedArchive: true,
    }),

    // Rotating File Transport for All Logs
    new winston.transports.DailyRotateFile({
      filename: path.join("logs", "combined-%DATE%.log"),
      datePattern: "YYYY-MM-DD",
      format: detailedFormat,
      maxSize: "20m",
      maxFiles: "14d",
      zippedArchive: true,
    }),

    // Console Transport for Development
    new winston.transports.Console({
      format: consoleFormat,
    }),
  ],
  // Handle uncaught exceptions and rejections
  exceptionHandlers: [
    new winston.transports.File({
      filename: path.join("logs", "exceptions.log"),
      format: detailedFormat,
    }),
  ],
  rejectionHandlers: [
    new winston.transports.File({
      filename: path.join("logs", "rejections.log"),
      format: detailedFormat,
    }),
  ],
  exitOnError: false,
});

// Helper function to stringify objects for logging
export const stringifyForLog = (obj: any): string => {
  return JSON.stringify(
    obj,
    (key, value) => {
      if (typeof value === "bigint") return value.toString();
      if (value instanceof Error)
        return Object.getOwnPropertyNames(value).reduce((acc, prop) => {
          acc[prop] = (value as any)[prop];
          return acc;
        }, {} as any);
      return value;
    },
    2
  );
};

// Helper function to mask sensitive data
export const maskSensitiveData = (data: any): any => {
  const sensitiveFields = [
    "password",
    "token",
    "secret",
    "apiKey",
    "creditCard",
  ];
  const masked = { ...data };

  const maskField = (obj: any) => {
    for (const key in obj) {
      if (typeof obj[key] === "object" && obj[key] !== null) {
        maskField(obj[key]);
      } else if (
        sensitiveFields.some((field) => key.toLowerCase().includes(field))
      ) {
        obj[key] = "******";
      }
    }
  };

  maskField(masked);
  return masked;
};

// Performance monitoring
const performanceLogger = {
  start: (label: string) => {
    const start = process.hrtime();
    return {
      end: () => {
        const diff = process.hrtime(start);
        const duration = (diff[0] * 1e9 + diff[1]) / 1e6; // Convert to milliseconds
        logger.debug(`Performance: ${label} took ${duration.toFixed(2)}ms`);
        return duration;
      },
    };
  },
};

// Elysia plugin for logging
export const loggerPlugin = new Elysia()
  .derive(({ request, set }) => {
    const requestId = request.headers.get("x-request-id") || randomUUID();
    const startTime = Date.now();

    // Create request-specific logger
    const requestLogger = logger.child({
      requestId,
      method: request.method,
      url: request.url,
      userAgent: request.headers.get("user-agent"),
    });

    // Log request
    requestLogger.http(`Incoming ${request.method} request to ${request.url}`);

    // Log response after request is complete
    set.headers["x-request-id"] = requestId;

    return {
      requestLogger,
      logResponse: () => {
        const duration = Date.now() - startTime;
        requestLogger.http(
          `Request completed in ${duration}ms with status ${set.status}`
        );
      },
    };
  })
  .onAfterHandle(({ logResponse }) => {
    logResponse();
  });

// Error logging decorator
export const logError = (
  target: any,
  propertyKey: string,
  descriptor: PropertyDescriptor
) => {
  const originalMethod = descriptor.value;

  descriptor.value = async function (...args: any[]) {
    try {
      return await originalMethod.apply(this, args);
    } catch (error) {
      logger.error("Error in method execution", {
        method: propertyKey,
        error: stringifyForLog(error),
        args: maskSensitiveData(args),
      });
      throw error;
    }
  };

  return descriptor;
};

// Example usage:
/*
// In your Elysia app:
import { Elysia } from 'elysia';
import { logger, loggerPlugin, logError } from './logger';

const app = new Elysia()
  .use(loggerPlugin)
  .get('/', ({ requestLogger }) => {
    requestLogger.info('Handling root request');
    return 'Hello World';
  })
  .listen(3000);

// Using the performance logger
const perf = performanceLogger.start('database-query');
// ... do something
perf.end();

// Using the error decorator
class UserService {
  @logError
  async createUser(userData: any) {
    // ... user creation logic
  }
}

// Regular logging
logger.info('Application started', { environment: process.env.NODE_ENV });
logger.error('Error occurred', { error: new Error('Something went wrong') });
*/
