import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";

// CORS configuration (backend only)
export const corsConfig = cors({
  origin: (process.env.ALLOWED_ORIGINS || "").split(","),
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization"],
  credentials: true,
});

// Efficient input sanitization function
export function sanitizeInput(input: any): any {
  if (typeof input === "string") {
    return input.replace(/[<>]/g, ""); // Simple XSS protection
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

// Middleware for input sanitization (backend only)
export const sanitizationMiddleware = new Elysia().derive((context) => {
  const sanitizedBody = context.body ? sanitizeInput(context.body) : undefined;
  const sanitizedQuery = context.query
    ? sanitizeInput(context.query)
    : undefined;
  return { body: sanitizedBody, query: sanitizedQuery };
});

// Efficient API key sanitization
export function sanitizeApiKey(apiKey: string): string {
  return apiKey.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);
}

// Efficient file name sanitization
export function sanitizeFileName(fileName: string): string {
  const sanitized =
    fileName
      .split(/[\/\\]/)
      .pop()
      ?.replace(/[^a-zA-Z0-9.-]/g, "") || "";
  return sanitized.includes(".") ? sanitized : sanitized + ".unknown";
}

// Efficient sensitive info redaction
const sensitivePatterns = [
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[EMAIL REDACTED]",
  },
  {
    regex: /\b(?:\d{4}[-\s]?){3}\d{4}\b/g,
    replacement: "[CREDIT CARD REDACTED]",
  },
  {
    regex: /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g,
    replacement: "[PHONE NUMBER REDACTED]",
  },
  {
    regex: /\b(?!000|666|9\d{2})\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
    replacement: "[SSN REDACTED]",
  },
];

export function redactSensitiveInfo(input: any): any {
  if (typeof input === "string") {
    return sensitivePatterns.reduce(
      (acc, pattern) => acc.replace(pattern.regex, pattern.replacement),
      input
    );
  } else if (Array.isArray(input)) {
    return input.map(redactSensitiveInfo);
  } else if (typeof input === "object" && input !== null) {
    return Object.keys(input).reduce((acc: any, key) => {
      acc[key] = redactSensitiveInfo(input[key]);
      return acc;
    }, {});
  }
  return input;
}

// Efficient email validation
const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
export function isValidEmail(email: string): boolean {
  return emailRegex.test(email);
}

// Frontend-specific optimizations
if (typeof window !== "undefined") {
  // Memoized version of sanitizeInput for frontend
  const memoizedSanitizeInput = (() => {
    const cache = new Map();
    return (input: any) => {
      if (cache.has(input)) return cache.get(input);
      const result = sanitizeInput(input);
      cache.set(input, result);
      return result;
    };
  })();

  // Replace the original function with the memoized version
  (sanitizeInput as any) = memoizedSanitizeInput;
}