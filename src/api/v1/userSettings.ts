import { Elysia, t } from "elysia";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import crypto from "crypto";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { rateLimiter } from "../../utils/rateLimit";
import { isValidEmail, sanitizeInput } from "../../utils/security";
import { redactSensitiveInfo } from "../../utils/security";

const handlePrismaError = (error: unknown, operation: string) => {
  if (error instanceof PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      throw new AuthError(409, "Unique constraint violation");
    }
    if (error.code === "P2025") {
      throw new AuthError(404, "Record not found");
    }
  }
  logger.error(`Error in ${operation}:`, error);
  throw new AuthError(500, `Failed to ${operation}`);
};

const userSettingsSchema = t.Object({
  username: t.Optional(t.String({ minLength: 3, maxLength: 30 })),
  name: t.Optional(t.String({ maxLength: 100 })),
  email: t.Optional(t.String({ validate: isValidEmail })),
  bio: t.Optional(t.String({ maxLength: 500 })),
  avatar: t.Optional(t.String()),
  language: t.Optional(t.String()),
  theme: t.Optional(t.String()),
  githubProfileLink: t.Optional(t.String()),
  xProfileLink: t.Optional(t.String()),
  notificationPreferences: t.Optional(
    t.Object({
      emailNotifications: t.Boolean(),
    })
  ),
  privacySettings: t.Optional(
    t.Object({
      profileVisibility: t.Union([t.Literal("public"), t.Literal("private")]),
      showEmail: t.Optional(t.Boolean()),
    })
  ),
  twoFactorEnabled: t.Optional(t.Boolean()),
  defaultPaymentAddress: t.Optional(t.String()),
  selectedPaymentAddress: t.Optional(t.String()),
});

const renewApiKeySchema = t.Object({
  action: t.Literal("renew-api-key"),
});

export const userSettingsRouter = new Elysia()
  .use(authPlugin)
  .get("/", async ({ authenticatedUser }) => {
    if (!authenticatedUser) {
      logger.error("User settings GET - No authenticated user");
      throw new AuthError(401, "Authentication required");
    }

    const userAddress = authenticatedUser.walletAddress;
    logger.info(`User settings GET - User address: ${userAddress}`);

    try {
      const userSettings = await prisma.user.findUnique({
        where: { walletAddress: userAddress },
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
          notificationPreferences: true,
          privacySettings: true,
          twoFactorEnabled: true,
          defaultPaymentAddress: true,
          selectedPaymentAddress: true,
          apiKey: true,
          lastLoginAt: true,
        },
      });

      if (!userSettings) {
        logger.warn(`User settings not found for ${userAddress}`);
        throw new AuthError(404, "User settings not found");
      }

      logger.info(`User settings fetched successfully for ${userAddress}`);
      return redactSensitiveInfo(userSettings);
    } catch (error) {
      handlePrismaError(error, "fetch user settings");
    }
  })
  .put(
    "/",
    async ({ authenticatedUser, body }) => {
      if (!authenticatedUser) {
        logger.error("User settings PUT - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      const userAddress = authenticatedUser.walletAddress;
      logger.info(`User settings PUT - User address: ${userAddress}`);

      const sanitizedBody = sanitizeInput(body);

      try {
        const userSettings = await prisma.user.update({
          where: { walletAddress: userAddress },
          data: {
            ...sanitizedBody,
            notificationPreferences: sanitizedBody.notificationPreferences
              ? { update: sanitizedBody.notificationPreferences }
              : undefined,
            privacySettings: sanitizedBody.privacySettings
              ? { update: sanitizedBody.privacySettings }
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
            notificationPreferences: true,
            privacySettings: true,
            twoFactorEnabled: true,
            defaultPaymentAddress: true,
            selectedPaymentAddress: true,
            lastLoginAt: true,
          },
        });

        logger.info(`User settings updated successfully for ${userAddress}`, {
          changedFields: Object.keys(sanitizedBody),
        });
        return redactSensitiveInfo(userSettings);
      } catch (error) {
        handlePrismaError(error, "update user settings");
      }
    },
    {
      body: userSettingsSchema,
    }
  )
  .patch(
    "/",
    async ({ authenticatedUser, body }) => {
      if (!authenticatedUser) {
        logger.error("User settings PATCH - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      const userAddress = authenticatedUser.walletAddress;
      logger.info(`User settings PATCH - User address: ${userAddress}`);

      const sanitizedBody = sanitizeInput(body);

      try {
        const currentSettings = await prisma.user.findUnique({
          where: { walletAddress: userAddress },
          select: {
            notificationPreferences: true,
            privacySettings: true,
            updatedAt: true,
          },
        });

        if (!currentSettings) {
          throw new AuthError(404, "User settings not found");
        }

        const updatedSettings = {
          ...sanitizedBody,
          notificationPreferences: sanitizedBody.notificationPreferences
            ? { update: sanitizedBody.notificationPreferences }
            : undefined,
          privacySettings: sanitizedBody.privacySettings
            ? { update: sanitizedBody.privacySettings }
            : undefined,
        };

        const userSettings = await prisma.user.update({
          where: {
            walletAddress: userAddress,
            updatedAt: currentSettings.updatedAt,
          },
          data: updatedSettings,
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
            notificationPreferences: true,
            privacySettings: true,
            twoFactorEnabled: true,
            defaultPaymentAddress: true,
            selectedPaymentAddress: true,
            lastLoginAt: true,
          },
        });

        logger.info(`User settings patched successfully for ${userAddress}`, {
          changedFields: Object.keys(sanitizedBody),
        });
        return redactSensitiveInfo(userSettings);
      } catch (error) {
        if (
          error instanceof PrismaClientKnownRequestError &&
          error.code === "P2004"
        ) {
          throw new AuthError(
            409,
            "The user settings have been modified. Please try again."
          );
        }
        handlePrismaError(error, "patch user settings");
      }
    },
    {
      body: t.Partial(userSettingsSchema),
    }
  )
  .use(rateLimiter)
  .post(
    "/renew-api-key",
    async ({ body, set, jwt, cookie: { auth }, authenticatedUser }) => {
      logger.info("API key renewal for ", {
        walletAddress: authenticatedUser.walletAddress,
      });

      if (!auth) {
        set.status = 401;
        return { error: "Authentication required" };
      }

      try {
        const payload = await jwt.verify(auth.value);
        if (!payload) {
          set.status = 401;
          return { error: "Invalid token" };
        }

        const { action } = body;
        if (action !== "renew-api-key") {
          set.status = 400;
          return { error: "Invalid action" };
        }

        const newApiKey = crypto.randomBytes(32).toString("hex");

        const updatedUser = await prisma.user.update({
          where: { walletAddress: payload.sub as string },
          data: {
            apiKey: newApiKey,
            lastLoginAt: new Date(),
          },
        });

        if (!updatedUser) {
          set.status = 404;
          return { error: "User not found" };
        }

        logger.info(
          `API key renewed successfully for ${updatedUser.walletAddress}`
        );
        return { apiKey: newApiKey };
      } catch (error) {
        logger.error("Error renewing API key:", error);
        set.status = 500;
        return { error: "Failed to renew API key" };
      }
    },
    {
      body: renewApiKeySchema,
    }
  )
  .onError(({ error, set }) => {
    if (error instanceof AuthError) {
      set.status = error.statusCode;
      return { error: error.message };
    }

    logger.error("Unexpected error in user settings router", {
      error: error.message,
      stack: error.stack,
    });
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default userSettingsRouter;
