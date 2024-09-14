import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import xss from "xss";

// CORS configuration
export const corsConfig = cors({
  origin: (process.env.ALLOWED_ORIGINS || "").split(","),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// Input sanitization function
export function sanitizeInput(input: any): any {
  if (typeof input === "string") {
    return xss(input);
  } else if (Array.isArray(input)) {
    return input.map(sanitizeInput);
  } else if (typeof input === "object" && input !== null) {
    return Object.keys(input).reduce((acc: any, key) => {
      acc[key] = sanitizeInput(input[key]);
      return acc;
    }, {});
  }
  return input;
}

// Middleware for input sanitization
export const sanitizationMiddleware = new Elysia().derive((context) => {
  const sanitizedBody = context.body ? sanitizeInput(context.body) : undefined;
  const sanitizedQuery = context.query
    ? sanitizeInput(context.query)
    : undefined;

  return { body: sanitizedBody, query: sanitizedQuery };
});

// Function to validate and sanitize API keys
export function sanitizeApiKey(apiKey: string): string {
  // Remove any whitespace
  let sanitized = apiKey.trim();

  // Ensure it only contains alphanumeric characters and dashes
  sanitized = sanitized.replace(/[^a-zA-Z0-9-]/g, "");

  // Limit the length to prevent excessively long keys
  const MAX_API_KEY_LENGTH = 64;
  sanitized = sanitized.slice(0, MAX_API_KEY_LENGTH);

  return sanitized;
}

// Helper function to validate and sanitize file names
export function sanitizeFileName(fileName: string): string {
  // Remove any path traversal attempts
  let sanitized = fileName.replace(/^.*[\\\/]/, "");

  // Remove any non-alphanumeric characters except for dots and dashes
  sanitized = sanitized.replace(/[^a-zA-Z0-9.-]/g, "");

  // Ensure the file has an extension
  if (!sanitized.includes(".")) {
    sanitized += ".unknown";
  }

  return sanitized;
}
