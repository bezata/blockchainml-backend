import { Elysia, t } from "elysia";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";

const userSettingsSchema = t.Object({
  name: t.Optional(t.String()),
  email: t.Optional(t.String()),
  bio: t.Optional(t.String()),
  avatar: t.Optional(t.String()),
  language: t.Optional(t.String()),
  theme: t.Optional(t.String()),
  notifications: t.Optional(
    t.Object({
      email: t.Boolean(),
      push: t.Boolean(),
      sms: t.Boolean(),
    })
  ),
  privacy: t.Optional(
    t.Object({
      profileVisibility: t.Union([t.Literal("public"), t.Literal("private")]),
      showEmail: t.Boolean(),
    })
  ),
  twoFactor: t.Optional(t.Boolean()),
  defaultPaymentAddress: t.Optional(t.String()),
  paymentAddress: t.Optional(t.String()),
});

export const userSettingsRouter = new Elysia()
  .use(authPlugin)
  .get("/", async ({ authenticatedUser, set }) => {
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
          name: true,
          email: true,
          bio: true,
          avatar: true,
          chainId: true,
          language: true,
          theme: true,
          notifications: true,
          privacy: true,
          twoFactor: true,
          defaultPaymentAddress: true,
          paymentAddress: true,
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
          data: body,
          select: {
            walletAddress: true,
            name: true,
            email: true,
            bio: true,
            avatar: true,
            chainId: true,
            language: true,
            theme: true,
            notifications: true,
            privacy: true,
            twoFactor: true,
            defaultPaymentAddress: true,
            paymentAddress: true,
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
        const currentUser = await prisma.user.findUnique({
          where: { walletAddress: userAddress },
          select: { privacy: true },
        });

        if (!currentUser) {
          throw new AuthError(404, "User not found");
        }

        const updatedPrivacy = body.privacy
          ? {
              ...((currentUser.privacy as object) || {}),
              ...body.privacy,
            }
          : currentUser.privacy;

        const userSettings = await prisma.user.update({
          where: { walletAddress: userAddress },
          data: {
            ...body,
            privacy: updatedPrivacy,
          },
          select: {
            walletAddress: true,
            name: true,
            email: true,
            bio: true,
            avatar: true,
            chainId: true,
            language: true,
            theme: true,
            notifications: true,
            privacy: true,
            twoFactor: true,
            defaultPaymentAddress: true,
            paymentAddress: true,
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
  .onError(({ error, set }) => {
    logger.error("Unexpected error in user settings router:", error);
    if (error instanceof AuthError) {
      set.status = error.statusCode;
      return { error: error.message };
    }
    set.status = 500;
    return { error: "An unexpected error occurred" };
  });

export default userSettingsRouter;
