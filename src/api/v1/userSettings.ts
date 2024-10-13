import { Elysia } from "elysia";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import { AuthError, requireAuth } from "./auth";
import { Prisma } from "@prisma/client";

export const userSettingsRouter = new Elysia()
  .use(requireAuth)
  .get("/", async (context) => {
    console.log(
      "User settings GET - Full context:",
      JSON.stringify(context, null, 2)
    );

    const userAddress = context.headers["x-user-address"];
    console.log("User settings GET - User address from header:", userAddress);

    if (!userAddress) {
      logger.error("User settings GET - No user address in header");
      throw new AuthError(401, "No user address provided");
    }

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

      console.log(
        "User settings GET - Database query result:",
        JSON.stringify(userSettings, null, 2)
      );

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
  .put("/", async (context) => {
    const userAddress = context.headers["x-user-address"];
    if (!userAddress) {
      logger.error("User settings PUT - No user address in header");
      throw new AuthError(401, "No user address provided");
    }

    const updatedSettings = context.body as {
      name?: string;
      email?: string;
      bio?: string;
      avatar?: string;
      chainId?: number;
      language?: string;
      theme?: string;
      notifications?: boolean;
      privacy?: any;
      twoFactor?: boolean;
      defaultPaymentAddress?: string;
      paymentAddress?: string;
    };

    try {
      const userSettings = await prisma.user.update({
        where: { walletAddress: userAddress },
        data: updatedSettings as Prisma.UserUpdateInput,
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
  })
  .onError(({ error }) => {
    logger.error("Unexpected error in user settings router:", error);
    if (error instanceof AuthError) {
      return { error: error.message, status: error.statusCode };
    }
    return { error: "An unexpected error occurred", status: 500 };
  });

export default userSettingsRouter;
