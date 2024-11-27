import { Elysia, Static, t } from "elysia";
import { authPlugin, AuthError } from "@/middleware/authPlugin";
import prisma from "@/middleware/prismaclient";
import { Prisma } from "@prisma/client";
import { logger } from "@/utils/monitor";
import crypto from "crypto";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { UserSettingsSchema } from "@/types/userSettings/userSettingsSchema";
import { userSettingsSchema } from "@/types/userSettings/userSettingsSchema";
import {
  sanitizeInput,
  enhancedRedactSensitiveInfo,
  validation,
  type SanitizationContext,
} from "@/utils/security";

const createPerformanceTracker = (label: string) => {
  const start = process.hrtime();
  return {
    end: () => {
      const diff = process.hrtime(start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };
};

type UserSettingsInput = Static<typeof userSettingsSchema>;

const renewApiKeySchema = t.Object({
  action: t.Literal("renew-api-key"),
});

const validateMonetizationSettings = {
  paymentMethod: ["crypto", "stripe", "paypal"],
  subscriptionTier: ["free", "basic", "pro", "enterprise"],
  paymentChainId: ["eth", "polygon", "bsc", "sol"],
};
// Type-safe error handling
const handlePrismaError = (error: unknown, operation: string) => {
  const perf = createPerformanceTracker(`prisma-error-${operation}`);

  if (error instanceof PrismaClientKnownRequestError) {
    logger.error(`Prisma error in ${operation}`, {
      code: error.code,
      meta: error.meta,
      message: error.message,
      stack: error.stack,
      operation,
    });

    const duration = perf.end();

    if (error.code === "P2002") {
      throw new AuthError(409, "Unique constraint violation");
    }
    if (error.code === "P2025") {
      throw new AuthError(404, "Record not found");
    }
  }

  const duration = perf.end();
  logger.error(`Error in ${operation}:`, {
    error:
      error instanceof Error
        ? {
            name: error.name,
            message: error.message,
            stack: error.stack,
          }
        : error,
    duration,
  });
  throw new AuthError(500, `Failed to ${operation}`);
};

// Fix the validation function
const validateUserSettings = (input: unknown): UserSettingsInput => {
  if (!input || typeof input !== "object") {
    throw new Error("Input must be an object");
  }

  const result: Partial<UserSettingsInput> = {};
  const inputObj = input as Record<string, unknown>;

  // Validation functions for specific types
  const validateOptionalString = (
    value: unknown,
    field: string,
    minLength?: number,
    maxLength?: number
  ): string | undefined => {
    if (value === undefined) return undefined;
    if (typeof value !== "string") {
      throw new Error(`${field} must be a string`);
    }
    if (minLength && value.length < minLength) {
      throw new Error(`${field} must be at least ${minLength} characters`);
    }
    if (maxLength && value.length > maxLength) {
      throw new Error(`${field} must not exceed ${maxLength} characters`);
    }
    return value;
  };

  // Handle individual fields
  if ("username" in inputObj) {
    result.username = validateOptionalString(
      inputObj.username,
      "username",
      3,
      30
    );
  }

  if ("name" in inputObj) {
    result.name = validateOptionalString(inputObj.name, "name", undefined, 100);
  }

  if ("email" in inputObj) {
    const email = validateOptionalString(inputObj.email, "email");
    if (email !== undefined && !validation.isValidEmail(email)) {
      throw new Error("Invalid email format");
    }
    result.email = email;
  }

  if ("bio" in inputObj) {
    result.bio = validateOptionalString(inputObj.bio, "bio", undefined, 500);
  }

  // Handle simple string fields
  const simpleStringFields: (keyof UserSettingsSchema)[] = [
    "avatar",
    "language",
    "theme",
    "githubProfileLink",
    "xProfileLink",
    "discordProfileLink",
    "defaultPaymentAddress",
    "selectedPaymentAddress",
  ];

  simpleStringFields.forEach((field) => {
    if (field in inputObj) {
      (result as any)[field] = validateOptionalString(inputObj[field], field);
    }
  });

  // Handle notification preferences
  if ("notificationPreferences" in inputObj) {
    const prefs = inputObj.notificationPreferences;
    if (prefs !== undefined) {
      if (typeof prefs !== "object" || prefs === null) {
        throw new Error("Notification preferences must be an object");
      }
      const { emailNotifications } = prefs as Record<string, unknown>;
      if (typeof emailNotifications !== "boolean") {
        throw new Error("emailNotifications must be a boolean");
      }
      result.notificationPreferences = { emailNotifications };
    }
  }

  if ("privacySettings" in inputObj) {
    const settings = inputObj.privacySettings;
    if (settings !== undefined) {
      if (typeof settings !== "object" || settings === null) {
        throw new Error("Privacy settings must be an object");
      }
      const { profileVisibility, showEmail } = settings as Record<
        string,
        unknown
      >;

      if (
        typeof profileVisibility !== "string" ||
        !["public", "private", "friends"].includes(profileVisibility)
      ) {
        throw new Error(
          'profileVisibility must be either "public" or "private" or "friends"'
        );
      }

      result.privacySettings = {
        profileVisibility: profileVisibility as
          | "public"
          | "private"
          | "friends",
      };

      if (showEmail !== undefined) {
        if (typeof showEmail !== "boolean") {
          throw new Error("showEmail must be a boolean");
        }
        result.privacySettings.showEmail = showEmail;
      }
    }
  }

  // Handle twoFactorEnabled
  if ("twoFactorEnabled" in inputObj) {
    const twoFactor = inputObj.twoFactorEnabled;
    if (twoFactor !== undefined) {
      if (typeof twoFactor !== "boolean") {
        throw new Error("twoFactorEnabled must be a boolean");
      }
      result.twoFactorEnabled = twoFactor;
    }
  }

  if ("paymentChainId" in inputObj) {
    const chainId = inputObj.paymentChainId;
    if (chainId !== undefined && typeof chainId !== "string") {
      throw new Error("paymentChainId must be a string");
    }
    result.monetizationSettings = result.monetizationSettings || {};
    result.monetizationSettings.paymentChainId = chainId;
  }

  return result as UserSettingsInput;
};

// Type-safe sanitization
export const sanitizeUserSettings = (input: unknown): UserSettingsInput => {
  const sanitized = sanitizeInput(input, "general" as SanitizationContext);
  return validateUserSettings(sanitized);
};

export const userSettingsRouter = new Elysia()
  .use(authPlugin)
  .get("/", async ({ authenticatedUser, store }) => {
    const perf = createPerformanceTracker("get-user-settings");
    const requestLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      requestLogger.error("User settings GET - No authenticated user");
      throw new AuthError(401, "Authentication required");
    }

    const userAddress = authenticatedUser.walletAddress;
    requestLogger.info("Fetching user settings", {
      userAddress: enhancedRedactSensitiveInfo(
        { address: userAddress },
        { preserveWalletAddress: true }
      ).address,
      operation: "GET",
    });

    try {
      const userSettings = await prisma.user.findUnique({
        where: { walletAddress: userAddress },
        select: {
          walletAddress: true,
          solanaAddress: true,
          username: true,
          name: true,
          email: true,
          bio: true,
          avatar: true,
          chainId: true,
          language: true,
          theme: true,
          githubProfileLink: true,
          xProfileLink: true,
          notificationPreferences: true,
          privacySettings: true,
          discordProfileLink: true,
          twoFactorEnabled: true,
          defaultPaymentAddress: true,
          selectedPaymentAddress: true,
          apiKey: true,
          lastLoginAt: true,
          monetizationSettings: {
            select: {
              paymentChainId: true,
            },
          },
        },
      });

      if (!userSettings) {
        const duration = perf.end();
        requestLogger.warn("User settings not found", {
          userAddress: enhancedRedactSensitiveInfo(
            { address: userAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
        });
        throw new AuthError(404, "User settings not found");
      }

      const duration = perf.end();
      requestLogger.info("User settings retrieved successfully", {
        userAddress: enhancedRedactSensitiveInfo(
          { address: userAddress },
          { preserveWalletAddress: true }
        ).address,
        duration,
        fields: Object.keys(userSettings),
      });

      return enhancedRedactSensitiveInfo(userSettings, {
        preserveWalletAddress: true,
      });
    } catch (error) {
      perf.end();
      handlePrismaError(error, "fetch user settings");
    }
  })
  .put(
    "/",
    async ({ authenticatedUser, body, store }) => {
      const perf = createPerformanceTracker("update-user-settings");
      const requestLogger = (store as any)?.requestLogger || logger;

      if (!authenticatedUser) {
        requestLogger.error("User settings PUT - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      const userAddress = authenticatedUser.walletAddress;
      requestLogger.info("Updating user settings", {
        userAddress: enhancedRedactSensitiveInfo(
          { address: userAddress },
          { preserveWalletAddress: true }
        ).address,
        operation: "PUT",
        updatedFields: Object.keys(body || {}),
      });

      try {
        const sanitizedBody = sanitizeUserSettings(body);

        const userSettings = await prisma.user.update({
          where: { walletAddress: userAddress },
          data: {
            ...sanitizedBody,
            notificationPreferences: sanitizedBody.notificationPreferences
              ? { set: JSON.stringify(sanitizedBody.notificationPreferences) }
              : undefined,
            privacySettings: sanitizedBody.privacySettings
              ? { set: JSON.stringify(sanitizedBody.privacySettings) }
              : undefined,
            monetizationSettings: sanitizedBody.monetizationSettings
              ? {
                  upsert: {
                    create: sanitizedBody.monetizationSettings,
                    update: sanitizedBody.monetizationSettings,
                  },
                }
              : undefined,
          },
          select: {
            walletAddress: true,
            username: true,
            name: true,
            email: true,
            bio: true,
            avatar: true,
            chainId: true,
            language: true,
            theme: true,
            githubProfileLink: true,
            xProfileLink: true,
            discordProfileLink: true,
            notificationPreferences: true,
            privacySettings: true,
            twoFactorEnabled: true,
            defaultPaymentAddress: true,
            solanaAddress: true,
            selectedPaymentAddress: true,
            lastLoginAt: true,
            monetizationSettings: {
              select: {
                paymentMethod: true,
                paymentChainId: true,
                subscriptionTier: true,
                subscriptionStatus: true,
                lastPaymentDate: true,
              },
            },
          },
        });

        const duration = perf.end();
        requestLogger.info("User settings updated successfully", {
          userAddress: enhancedRedactSensitiveInfo(
            { address: userAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
          changedFields: Object.keys(sanitizedBody),
        });

        return enhancedRedactSensitiveInfo(userSettings, {
          preserveWalletAddress: true,
        });
      } catch (error) {
        perf.end();
        handlePrismaError(error, "update user settings");
      }
    },
    { body: userSettingsSchema }
  )
  .patch(
    "/",
    async ({ authenticatedUser, body, store }) => {
      const perf = createPerformanceTracker("patch-user-settings");
      const requestLogger = (store as any)?.requestLogger || logger;

      if (!authenticatedUser) {
        requestLogger.error("User settings PATCH - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      const userAddress = authenticatedUser.walletAddress;
      requestLogger.info("Patching user settings", {
        userAddress: enhancedRedactSensitiveInfo(
          { address: userAddress },
          { preserveWalletAddress: true }
        ).address,
        operation: "PATCH",
        updatedFields: Object.keys(body || {}),
      });

      try {
        // Verify user exists
        const currentSettings = await prisma.user.findUnique({
          where: { walletAddress: userAddress },
          select: {
            notificationPreferences: true,
            privacySettings: true,
            updatedAt: true,
          },
        });

        if (!currentSettings) {
          const duration = perf.end();
          requestLogger.warn("User settings not found for PATCH", {
            userAddress: enhancedRedactSensitiveInfo(
              { address: userAddress },
              { preserveWalletAddress: true }
            ).address,
            duration,
          });
          throw new AuthError(404, "User settings not found");
        }

        // Sanitize and parse the body
        const sanitizedBody = sanitizeUserSettings(body);

        // Update user settings
        const userSettings = await prisma.user.update({
          where: {
            walletAddress: userAddress,
          },
          data: {
            ...sanitizedBody,
            notificationPreferences: sanitizedBody.notificationPreferences
              ? { set: JSON.stringify(sanitizedBody.notificationPreferences) }
              : undefined,
            privacySettings: sanitizedBody.privacySettings
              ? { set: JSON.stringify(sanitizedBody.privacySettings) }
              : undefined,
            monetizationSettings: sanitizedBody.monetizationSettings
              ? {
                  upsert: {
                    create: sanitizedBody.monetizationSettings,
                    update: sanitizedBody.monetizationSettings,
                  },
                }
              : undefined,
          },
          select: {
            walletAddress: true,
            username: true,
            name: true,
            email: true,
            bio: true,
            avatar: true,
            chainId: true,
            language: true,
            theme: true,
            githubProfileLink: true,
            xProfileLink: true,
            discordProfileLink: true,
            notificationPreferences: true,
            privacySettings: true,
            twoFactorEnabled: true,
            defaultPaymentAddress: true,
            solanaAddress: true,
            selectedPaymentAddress: true,
            lastLoginAt: true,
            linkedinProfileLink: true,
            monetizationSettings: {
              select: {
                paymentMethod: true,
                paymentChainId: true,
                subscriptionTier: true,
                subscriptionStatus: true,
                lastPaymentDate: true,
              },
            },
          },
        });

        const duration = perf.end();
        requestLogger.info("User settings patched successfully", {
          userAddress: enhancedRedactSensitiveInfo(
            { address: userAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
          changedFields: Object.keys(sanitizedBody),
        });

        return enhancedRedactSensitiveInfo(userSettings, {
          preserveWalletAddress: true,
        });
      } catch (error) {
        const duration = perf.end();
        requestLogger.error("Error in patch user settings", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          duration,
        });

        if (error instanceof AuthError) {
          throw error;
        }

        throw new AuthError(500, "Failed to patch user settings");
      }
    },
    { body: t.Partial(userSettingsSchema) }
  )
  .post(
    "/renew-api-key",
    async ({ body, set, jwt, cookie: { auth }, authenticatedUser, store }) => {
      const perf = createPerformanceTracker("renew-api-key");
      const requestLogger = (store as any)?.requestLogger || logger;

      requestLogger.info("API key renewal request", {
        userAddress: enhancedRedactSensitiveInfo(
          { address: authenticatedUser.walletAddress },
          { preserveWalletAddress: true }
        ).address,
      });

      if (!auth) {
        const duration = perf.end();
        requestLogger.warn("API key renewal - No auth token", { duration });
        set.status = 401;
        return { error: "Authentication required" };
      }

      try {
        const payload = await jwt.verify(auth.value);
        if (!payload) {
          const duration = perf.end();
          requestLogger.warn("API key renewal - Invalid token", { duration });
          set.status = 401;
          return { error: "Invalid token" };
        }

        const newApiKey = crypto.randomBytes(32).toString("hex");

        const updatedUser = await prisma.user.update({
          where: { walletAddress: payload.sub as string },
          data: {
            apiKey: newApiKey,
            lastLoginAt: new Date(),
          },
        });

        const duration = perf.end();
        requestLogger.info("API key renewed successfully", {
          userAddress: enhancedRedactSensitiveInfo(
            { address: updatedUser.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
        });

        return {
          apiKey: enhancedRedactSensitiveInfo({ apiKey: newApiKey }).apiKey,
        };
      } catch (error) {
        const duration = perf.end();
        requestLogger.error("Error renewing API key", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          duration,
        });
        set.status = 500;
        return { error: "Failed to renew API key" };
      }
    },
    { body: renewApiKeySchema }
  )
  .onError(({ error, set, store }) => {
    const errorLogger = (store as any)?.requestLogger || logger;

    if (error instanceof AuthError) {
      errorLogger.warn("Auth error in user settings", {
        statusCode: error.statusCode,
        message: error.message,
      });
      set.status = error.statusCode;
      return { error: error.message };
    }

    errorLogger.error("Unexpected error in user settings router", {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    });
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default userSettingsRouter;
