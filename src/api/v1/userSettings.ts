import { Elysia } from "elysia";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import { Prisma } from "@prisma/client";

export const userSettingsRouter = new Elysia()
  .use(authPlugin)
  .get("/", async ({ authenticatedUser, set }) => {
    if (!authenticatedUser) {
      logger.error("User settings GET - No authenticated user");
      set.status = 401;
      return { error: "Authentication required" };
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
        set.status = 404;
        return { error: "User settings not found" };
      }

      logger.info(`User settings fetched successfully for ${userAddress}`);
      return userSettings;
    } catch (error) {
      logger.error(`Error fetching user settings for ${userAddress}:`, error);
      set.status = 500;
      return { error: "Failed to fetch user settings" };
    }
  })
  .put("/", async ({ authenticatedUser, body, set }) => {
    if (!authenticatedUser) {
      logger.error("User settings PUT - No authenticated user");
      set.status = 401;
      return { error: "Authentication required" };
    }

    const userAddress = authenticatedUser.walletAddress;
    logger.info(`User settings PUT - User address: ${userAddress}`);

    const updatedSettings = body as Prisma.UserUpdateInput;

    try {
      const userSettings = await prisma.user.update({
        where: { walletAddress: userAddress },
        data: updatedSettings,
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
      set.status = 500;
      return { error: "Failed to update user settings" };
    }
  })
  .onError(({ error, set }) => {
    logger.error("Unexpected error in user settings router:", error);
    set.status = error instanceof AuthError ? error.statusCode : 500;
    return {
      error: error instanceof AuthError ? error.message : "An unexpected error occurred",
    };
  });

export default userSettingsRouter;
