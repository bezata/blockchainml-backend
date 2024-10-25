import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { logger } from "./monitor";
import { z } from "zod";

// Email regex pattern definition
const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

// Enhanced CORS configuration with proper typing
export const corsConfig = cors({
  origin: (request: Request): boolean => {
    const allowedOrigins = (process.env.ALLOWED_ORIGINS || "").split(",");
    const requestOrigin = request.headers.get("origin");
    const isAllowed = requestOrigin
      ? allowedOrigins.includes(requestOrigin)
      : false;

    logger.debug("CORS origin check", {
      requestOrigin: requestOrigin || "none",
      isAllowed,
      allowedOrigins,
    });

    return isAllowed;
  },
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Request-ID",
    "X-API-Key",
    "X-SIWE-Message",
    "X-SIWE-Signature",
  ],
  credentials: true,
  maxAge: 86400, // 24 hours
});

// Zod schemas for validation
const userInputSchema = z.object({
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.string(),
  email: z.string().regex(EMAIL_REGEX).optional(),
  username: z.string().min(3).max(30),
  bio: z.string().max(500).optional(),
  avatar: z.string().url().optional(),
  githubProfileLink: z.string().url().optional(),
  xProfileLink: z.string().url().optional(),
  defaultPaymentAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  selectedPaymentAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .optional(),
  notificationPreferences: z.record(z.boolean()).optional(),
  privacySettings: z.record(z.boolean()).optional(),
});

// Types for sanitization context
type SanitizationContext = "general" | "auth" | "siwe-message";

// Enhanced input sanitization with proper typing
export function sanitizeInput(
  input: unknown,
  context: SanitizationContext = "general"
): unknown {
  const perf = {
    start: process.hrtime(),
    end: () => {
      const diff = process.hrtime(perf.start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };

  try {
    if (typeof input === "string") {
      // Preserve SIWE messages
      if (context === "siwe-message") {
        return input;
      }
      // Enhanced XSS protection
      return input
        .replace(/<(?!br\s*\/?)[^>]+>/g, "") // Allow <br> tags only
        .replace(/javascript:/gi, "")
        .replace(/on\w+=/gi, "")
        .replace(/data:/gi, "")
        .trim();
    }

    if (Array.isArray(input)) {
      return input.map((item) => sanitizeInput(item, context));
    }

    if (typeof input === "object" && input !== null) {
      return Object.entries(input).reduce(
        (acc: Record<string, unknown>, [key, value]) => {
          // Special handling for known fields
          const fieldContext =
            key === "message" && context === "auth" ? "siwe-message" : context;
          acc[key] = sanitizeInput(value, fieldContext);
          return acc;
        },
        {}
      );
    }

    return input;
  } finally {
    const duration = perf.end();
    logger.debug("Input sanitization completed", {
      context,
      duration,
      inputType: typeof input,
    });
  }
}

// Enhanced middleware with proper typing
export const sanitizationMiddleware = new Elysia().derive(
  ({ request, body, query }) => {
    const perf = {
      start: process.hrtime(),
      end: () => {
        const diff = process.hrtime(perf.start);
        return (diff[0] * 1e9 + diff[1]) / 1e6;
      },
    };

    const context: SanitizationContext = request.url.includes("/auth")
      ? "auth"
      : "general";

    const sanitizedBody = body ? sanitizeInput(body, context) : undefined;
    const sanitizedQuery = query ? sanitizeInput(query, context) : undefined;

    const duration = perf.end();
    logger.debug("Request sanitization completed", {
      path: request.url,
      context,
      duration,
      hasSanitizedBody: !!sanitizedBody,
      hasSanitizedQuery: !!sanitizedQuery,
    });

    return {
      body: sanitizedBody,
      query: sanitizedQuery,
    };
  }
);
// Enhanced API key sanitization with validation
export function sanitizeApiKey(apiKey: string): string {
  const perf = {
    start: process.hrtime(),
    end: () => {
      const diff = process.hrtime(perf.start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };

  try {
    const sanitized = apiKey.replace(/[^a-zA-Z0-9-]/g, "").slice(0, 64);

    if (sanitized.length < 32) {
      logger.warn("API key sanitization resulted in too short key", {
        originalLength: apiKey.length,
        sanitizedLength: sanitized.length,
      });
      throw new Error("Invalid API key format");
    }

    return sanitized;
  } finally {
    const duration = perf.end();
    logger.debug("API key sanitization completed", { duration });
  }
}

// Enhanced sensitive info redaction with blockchain-specific patterns
const sensitivePatterns = [
  {
    regex: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: (email: string) => {
      const [local, domain] = email.split("@");
      const maskedLocal =
        local.length <= 4
          ? "*".repeat(local.length)
          : `${local.charAt(0)}${local.charAt(1)}${"*".repeat(
              local.length - 3
            )}${local.charAt(local.length - 1)}`;
      return `${maskedLocal}@${domain}`;
    },
  },
  {
    regex: /\b0x[a-fA-F0-9]{40}\b/g,
    replacement: (address: string) =>
      `${address.slice(0, 6)}...${address.slice(-4)}`,
  },
  {
    regex: /"apiKey":\s*"([^"]+)"/g,
    replacement: '"apiKey": "[REDACTED]"',
  },
  {
    regex: /"privateKey":\s*"([^"]+)"/g,
    replacement: '"privateKey": "[REDACTED]"',
  },
  {
    regex: /"signature":\s*"([^"]+)"/g,
    replacement: '"signature": "[REDACTED]"',
  },
  // ... previous patterns ...
];

// Enhanced redaction with logging and validation
export function enhancedRedactSensitiveInfo(
  input: any,
  options: {
    preserveWalletAddress?: boolean;
    preserveSignature?: boolean;
  } = {}
): any {
  const perf = {
    start: process.hrtime(),
    end: () => {
      const diff = process.hrtime(perf.start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };

  try {
    if (typeof input === "string") {
      return sensitivePatterns.reduce((acc, pattern) => {
        // Skip wallet address redaction if preserveWalletAddress is true
        if (
          options.preserveWalletAddress &&
          pattern.regex.toString().includes("0x[a-fA-F0-9]{40}")
        ) {
          return acc;
        }
        // Skip signature redaction if preserveSignature is true
        if (
          options.preserveSignature &&
          pattern.regex.toString().includes("signature")
        ) {
          return acc;
        }
        return acc.replace(pattern.regex, pattern.replacement as any);
      }, input);
    }

    if (Array.isArray(input)) {
      return input.map((item) => enhancedRedactSensitiveInfo(item, options));
    }

    if (typeof input === "object" && input !== null) {
      return Object.keys(input).reduce((acc: any, key) => {
        acc[key] = enhancedRedactSensitiveInfo(input[key], options);
        return acc;
      }, {});
    }

    return input;
  } finally {
    const duration = perf.end();
    logger.debug("Sensitive info redaction completed", {
      duration,
      options,
    });
  }
}

// Enhanced validation utilities
export const validation = {
  isValidWalletAddress: (address: string): boolean =>
    /^0x[a-fA-F0-9]{40}$/.test(address),

  isValidChainId: (chainId: string): boolean =>
    /^0x[0-9a-fA-F]+$|^\d+$/.test(chainId),

  isValidEmail: (email: string): boolean => EMAIL_REGEX.test(email),

  isValidUsername: (username: string): boolean =>
    /^[a-zA-Z0-9_-]{3,30}$/.test(username),

  validateUserInput: (input: unknown) => {
    try {
      return userInputSchema.parse(input);
    } catch (error) {
      logger.warn("User input validation failed", { error });
      throw new Error("Invalid user input");
    }
  },
};

// Frontend optimizations with proper typing
if (typeof window !== "undefined") {
  const createMemoizedFunction = <T extends Function>(fn: T): T => {
    const cache = new Map<string, { value: unknown; timestamp: number }>();
    const cacheTimeout = 5000; // 5 seconds

    return ((...args: unknown[]) => {
      const key = JSON.stringify(args);
      const cached = cache.get(key);

      if (cached && Date.now() - cached.timestamp < cacheTimeout) {
        return cached.value;
      }

      const result = fn(...args);
      cache.set(key, {
        value: result,
        timestamp: Date.now(),
      });

      // Cleanup old cache entries
      if (cache.size > 1000) {
        const now = Date.now();
        Array.from(cache.entries()).forEach(([key, value]) => {
          if (now - value.timestamp > cacheTimeout) {
            cache.delete(key);
          }
        });
      }

      return result;
    }) as unknown as T;
  };

  (sanitizeInput as any) = createMemoizedFunction(sanitizeInput);
  (enhancedRedactSensitiveInfo as any) = createMemoizedFunction(
    enhancedRedactSensitiveInfo
  );
}

// Proper type exports
export type { SanitizationContext };

export default {
  corsConfig,
  sanitizeInput,
  sanitizationMiddleware,
  sanitizeApiKey,
  enhancedRedactSensitiveInfo,
  validation,
};
