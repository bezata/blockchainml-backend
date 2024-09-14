import { Elysia } from "elysia";
import { logger } from "./monitor";

export class AppError extends Error {
  constructor(public message: string, public statusCode: number) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler = new Elysia().onError(({ code, error, set }) => {
  logger.error(`Error ${code}: ${error.message}`, { stack: error.stack });

  if (error instanceof AppError) {
    set.status = error.statusCode;
    return {
      success: false,
      error: error.message,
    };
  }

  const statusCode = code === "NOT_FOUND" ? 404 : 500;
  set.status = statusCode;

  return {
    success: false,
    error: statusCode === 500 ? "Internal Server Error" : error.message,
  };
});
