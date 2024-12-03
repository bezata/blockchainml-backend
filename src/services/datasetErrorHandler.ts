import { Elysia } from "elysia";
import { PrismaClientKnownRequestError, PrismaClientValidationError } from "@prisma/client/runtime/library";
import { logger } from "@/utils/monitor";

// Define error codes
export const ERROR_CODES = {
  // Authentication Errors (1xxx)
  UNAUTHORIZED: "ERR_1001",
  INVALID_TOKEN: "ERR_1002",
  TOKEN_EXPIRED: "ERR_1003",
  INSUFFICIENT_PERMISSIONS: "ERR_1004",
  
  // Resource Errors (2xxx)
  RESOURCE_NOT_FOUND: "ERR_2001",
  RESOURCE_ALREADY_EXISTS: "ERR_2002",
  RESOURCE_CONFLICT: "ERR_2003",
  
  // Validation Errors (3xxx)
  VALIDATION_ERROR: "ERR_3001",
  INVALID_INPUT: "ERR_3002",
  MISSING_REQUIRED_FIELD: "ERR_3003",
  
  // Database Errors (4xxx)
  DATABASE_ERROR: "ERR_4001",
  TRANSACTION_FAILED: "ERR_4002",
  QUERY_FAILED: "ERR_4003",
  
  // External Service Errors (5xxx)
  SERVICE_UNAVAILABLE: "ERR_5001",
  EXTERNAL_API_ERROR: "ERR_5002",
  S3_ERROR: "ERR_5003",
  
  // Rate Limiting Errors (6xxx)
  RATE_LIMIT_EXCEEDED: "ERR_6001",
  
  // File Operation Errors (7xxx)
  FILE_TOO_LARGE: "ERR_7001",
  INVALID_FILE_TYPE: "ERR_7002",
  FILE_UPLOAD_FAILED: "ERR_7003",
  
  // Business Logic Errors (8xxx)
  INVALID_OPERATION: "ERR_8001",
  OPERATION_NOT_ALLOWED: "ERR_8002",
  
  // System Errors (9xxx)
  INTERNAL_SERVER_ERROR: "ERR_9001",
  NOT_IMPLEMENTED: "ERR_9002"
} as const;

// Define HTTP status codes for each error code
const ERROR_STATUS_CODES: Record<string, number> = {
  // Authentication Errors
  [ERROR_CODES.UNAUTHORIZED]: 401,
  [ERROR_CODES.INVALID_TOKEN]: 401,
  [ERROR_CODES.TOKEN_EXPIRED]: 401,
  [ERROR_CODES.INSUFFICIENT_PERMISSIONS]: 403,
  
  // Resource Errors
  [ERROR_CODES.RESOURCE_NOT_FOUND]: 404,
  [ERROR_CODES.RESOURCE_ALREADY_EXISTS]: 409,
  [ERROR_CODES.RESOURCE_CONFLICT]: 409,
  
  // Validation Errors
  [ERROR_CODES.VALIDATION_ERROR]: 400,
  [ERROR_CODES.INVALID_INPUT]: 400,
  [ERROR_CODES.MISSING_REQUIRED_FIELD]: 400,
  
  // Database Errors
  [ERROR_CODES.DATABASE_ERROR]: 500,
  [ERROR_CODES.TRANSACTION_FAILED]: 500,
  [ERROR_CODES.QUERY_FAILED]: 500,
  
  // External Service Errors
  [ERROR_CODES.SERVICE_UNAVAILABLE]: 503,
  [ERROR_CODES.EXTERNAL_API_ERROR]: 502,
  [ERROR_CODES.S3_ERROR]: 502,
  
  // Rate Limiting Errors
  [ERROR_CODES.RATE_LIMIT_EXCEEDED]: 429,
  
  // File Operation Errors
  [ERROR_CODES.FILE_TOO_LARGE]: 413,
  [ERROR_CODES.INVALID_FILE_TYPE]: 415,
  [ERROR_CODES.FILE_UPLOAD_FAILED]: 500,
  
  // Business Logic Errors
  [ERROR_CODES.INVALID_OPERATION]: 400,
  [ERROR_CODES.OPERATION_NOT_ALLOWED]: 403,
  
  // System Errors
  [ERROR_CODES.INTERNAL_SERVER_ERROR]: 500,
  [ERROR_CODES.NOT_IMPLEMENTED]: 501
};

// Base application error class
export class AppError extends Error {
  constructor(
    public code: keyof typeof ERROR_CODES,
    message: string,
    public statusCode: number = 500,
    public details?: any,
    public source?: string
  ) {
    super(message);
    this.name = "AppError";
  }

  toJSON() {
    return {
      error: {
        code: ERROR_CODES[this.code],
        message: this.message,
        details: this.details,
        source: this.source
      }
    };
  }
}

// Specific error classes
export class AuthenticationError extends AppError {
  constructor(code: Extract<keyof typeof ERROR_CODES, "UNAUTHORIZED" | "INVALID_TOKEN" | "TOKEN_EXPIRED">, message: string, details?: any) {
    super(code, message, ERROR_STATUS_CODES[ERROR_CODES[code]], details, "authentication");
    this.name = "AuthenticationError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: any) {
    super("VALIDATION_ERROR", message, 400, details, "validation");
    this.name = "ValidationError";
  }
}

export class ResourceError extends AppError {
  constructor(code: Extract<keyof typeof ERROR_CODES, "RESOURCE_NOT_FOUND" | "RESOURCE_ALREADY_EXISTS" | "RESOURCE_CONFLICT">, message: string, details?: any) {
    super(code, message, ERROR_STATUS_CODES[ERROR_CODES[code]], details, "resource");
    this.name = "ResourceError";
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: any) {
    super("DATABASE_ERROR", message, 500, details, "database");
    this.name = "DatabaseError";
  }
}

// Error handler middleware
export const errorHandler = new Elysia()
  .onError(({ code, error, set, request }) => {
    const requestId = request.headers.get("x-request-id") || "unknown";
    
    // Handle different types of errors
    if (error instanceof AppError) {
      set.status = error.statusCode;
      logger.error("Application error", {
        requestId,
        code: ERROR_CODES[error.code],
        message: error.message,
        details: error.details,
        source: error.source,
        stack: error.stack
      });
      return error.toJSON();
    }
    
    // Handle Prisma errors
    if (error instanceof PrismaClientKnownRequestError) {
      set.status = 400;
      const prismaError = handlePrismaError(error);
      logger.error("Prisma error", {
        requestId,
        ...prismaError,
        stack: error.stack
      });
      return prismaError;
    }

    if (error instanceof PrismaClientValidationError) {
      set.status = 400;
      logger.error("Prisma validation error", {
        requestId,
        message: error.message,
        stack: error.stack
      });
      return {
        error: {
          code: ERROR_CODES.VALIDATION_ERROR,
          message: "Invalid data provided",
          details: error.message
        }
      };
    }

    // Handle all other errors
    set.status = 500;
    logger.error("Unhandled error", {
      requestId,
      error: error instanceof Error ? {
        name: error.name,
        message: error.message,
        stack: error.stack
      } : error
    });

    return {
      error: {
        code: ERROR_CODES.INTERNAL_SERVER_ERROR,
        message: "An unexpected error occurred"
      }
    };
  });

// Helper function to handle Prisma errors
function handlePrismaError(error: PrismaClientKnownRequestError) {
  switch (error.code) {
    case "P2002":
      return {
        error: {
          code: ERROR_CODES.RESOURCE_ALREADY_EXISTS,
          message: "Resource already exists",
          details: {
            fields: error.meta?.target
          }
        }
      };
    case "P2025":
      return {
        error: {
          code: ERROR_CODES.RESOURCE_NOT_FOUND,
          message: "Resource not found",
          details: error.meta
        }
      };
    case "P2014":
      return {
        error: {
          code: ERROR_CODES.INVALID_INPUT,
          message: "Invalid relation data",
          details: error.meta
        }
      };
    default:
      return {
        error: {
          code: ERROR_CODES.DATABASE_ERROR,
          message: "Database operation failed",
          details: error.message
        }
      };
  }
}

// Utility function to create error responses
export function createErrorResponse(error: AppError) {
  return {
    error: {
      code: ERROR_CODES[error.code],
      message: error.message,
      details: error.details,
      source: error.source
    }
  };
}