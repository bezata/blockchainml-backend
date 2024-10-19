import { Elysia, t, ParseError } from "elysia";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import crypto from "crypto";

const userSettingsSchema = t.Object({
  username: t.Optional(t.String()),
  name: t.Optional(t.String()),
  email: t.Optional(t.String()),
  bio: t.Optional(t.String()),
  avatar: t.Optional(t.String()),
  language: t.Optional(t.String()),
  theme: t.Optional(t.String()),
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

// Add this type definition
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
          notificationPreferences: true,
          privacySettings: true,
          twoFactorEnabled: true,
          defaultPaymentAddress: true,
          selectedPaymentAddress: true,
          apiKey: true,
        },
      });

      if (!userSettings) {
        logger.warn(`User settings not found for ${userAddress}`);
        throw new AuthError(404, "User settings not found");
      }

      logger.info(`User settings fetched successfully for ${userAddress}`);
      return userSettings;
    } catch (error) {
      logger.error(`Error fetching user settings for ${userAddress}:`, error);
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user settings");
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

      try {
        const userSettings = await prisma.user.update({
          where: { walletAddress: userAddress },
          data: {
            ...body,
            notificationPreferences: body.notificationPreferences
              ? { update: body.notificationPreferences }
              : undefined,
            privacySettings: body.privacySettings
              ? { update: body.privacySettings }
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
            notificationPreferences: true,
            privacySettings: true,
            twoFactorEnabled: true,
            defaultPaymentAddress: true,
            selectedPaymentAddress: true,
          },
        });

        logger.info(`User settings updated successfully for ${userAddress}`);
        return userSettings;
      } catch (error) {
        logger.error(`Error updating user settings for ${userAddress}:`, error);
        throw new AuthError(500, "Failed to update user settings");
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

      try {
        // Fetch current user settings
        const currentSettings = await prisma.user.findUnique({
          where: { walletAddress: userAddress },
          select: {
            notificationPreferences: true,
            privacySettings: true,
          },
        });

        // Merge new settings with current settings
        const updatedSettings = {
          ...body,
          notificationPreferences: body.notificationPreferences
            ? { update: body.notificationPreferences }
            : undefined,
          privacySettings: body.privacySettings
            ? { update: body.privacySettings }
            : undefined,
        };

        const userSettings = await prisma.user.update({
          where: { walletAddress: userAddress },
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
            notificationPreferences: true,
            privacySettings: true,
            twoFactorEnabled: true,
            defaultPaymentAddress: true,
            selectedPaymentAddress: true,
          },
        });

        logger.info(`User settings patched successfully for ${userAddress}`);
        return userSettings;
      } catch (error) {
        logger.error(`Error patching user settings for ${userAddress}:`, error);
        if (error instanceof AuthError) throw error;
        throw new AuthError(500, "Failed to patch user settings");
      }
    },
    {
      body: t.Partial(userSettingsSchema),
    }
  )
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

        // Your API key renewal logic here
        const newApiKey = crypto.randomBytes(32).toString("hex");

        // Update the user's API key in the database
        const updatedUser = await prisma.user.update({
          where: { walletAddress: payload.sub as string },
          data: { apiKey: newApiKey },
        });

        if (!updatedUser) {
          set.status = 404;
          return { error: "User not found" };
        }

        return { apiKey: newApiKey };
      } catch (error) {
        console.error("Error renewing API key:", error);
        set.status = 500;
        return { error: "Failed to renew API key" };
      }
    },
    {
      body: renewApiKeySchema,
    }
  )
  .onError(({ error, set, request }) => {
    if (error instanceof ParseError) {
      logger.warn("Failed to parse request body", {
        body: request.body,
        error: error.message,
      });
      set.status = 400;
      return { error: "Invalid request body" };
    }

    logger.error("Unexpected error in user settings router", {
      error: error.message,
      stack: error.stack,
    });
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default userSettingsRouter;
