import { Elysia, t } from "elysia";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import { AuthError, requireAuth } from "./auth";
import { Prisma } from "@prisma/client";

type UserProfile = {
  walletAddress: string;
  name: string | null;
  email: string | null;
  bio: string | null;
  avatar: string | null;
  chainId: string;
  language: string | null;
  theme: string | null;
  notifications: any | null;
  privacy: Prisma.JsonValue;
  twoFactor: boolean;
  defaultPaymentAddress: string | null;
  paymentAddress: string | null;
  profileVisibility: Prisma.JsonValue;
};

export const userProfileRouter = new Elysia({ prefix: "/user" })
  .use(requireAuth)
  .get("/profile", async (context) => {
    logger.debug(
      "User profile GET - Full context:",
      JSON.stringify(context, null, 2)
    );

    const userAddress = context.headers["x-user-address"];
    logger.debug("User profile GET - User address from header:", userAddress);

    if (!userAddress) {
      logger.error("User profile GET - No user address in header");
      throw new AuthError(401, "No user address provided");
    }

    try {
      const userProfile = await prisma.user.findUnique({
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

      logger.debug(
        "User profile GET - Database query result:",
        JSON.stringify(userProfile, null, 2)
      );

      if (!userProfile) {
        logger.warn(`User profile not found for ${userAddress}`);
        throw new AuthError(404, "User profile not found");
      }

      logger.info(`User profile fetched successfully for ${userAddress}`);
      return userProfile as UserProfile;
    } catch (error) {
      logger.error(`Error fetching user profile for ${userAddress}:`, error);
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user profile");
    }
  })
  .get("/profile/:walletAddress", async (context) => {
    const { walletAddress } = context.params;
    const currentUserAddress = context.headers["x-user-address"];

    logger.debug(
      `User profile GET for ${walletAddress} - Current user: ${currentUserAddress}`
    );

    try {
      const profileUser = await prisma.user.findUnique({
        where: { walletAddress },
        select: {
          walletAddress: true,
          name: true,
          email: true,
          bio: true,
          avatar: true,
          chainId: true,
          privacy: true,
        },
      });

      if (!profileUser) {
        logger.warn(`User not found: ${walletAddress}`);
        throw new AuthError(404, "User not found");
      }

      const isOwnProfile = currentUserAddress === profileUser.walletAddress;
      const privacy = profileUser.privacy as {
        profileVisibility?: "public" | "private";
      };
      const isPublic = privacy?.profileVisibility === "public";

      const publicProfile = {
        walletAddress: profileUser.walletAddress,
        name: profileUser.name,
        avatar: profileUser.avatar,
        bio: profileUser.bio,
      };

      if (isOwnProfile || isPublic) {
        const privacySettings = profileUser.privacy as {
          showEmail?: boolean;
        } | null;
        return {
          ...publicProfile,
          chainId: profileUser.chainId,
          email: privacySettings?.showEmail ? profileUser.email : undefined,
        };
      }

      return publicProfile;
    } catch (error) {
      logger.error(`Error fetching user profile for ${walletAddress}:`, error);
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user profile");
    }
  })
  .patch(
    "/profile",
    async (context) => {
      const userAddress = context.headers["x-user-address"];
      logger.debug(
        "User profile PATCH - User address from header:",
        userAddress
      );

      if (!userAddress) {
        logger.error("User profile PATCH - No user address in header");
        throw new AuthError(401, "No user address provided");
      }

      try {
        const updatedUser = await prisma.user.update({
          where: { walletAddress: userAddress },
          data: context.body,
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
        logger.info(`User profile updated successfully for ${userAddress}`);
        return updatedUser as UserProfile;
      } catch (error) {
        logger.error(`Error updating user profile for ${userAddress}:`, error);
        throw new AuthError(500, "Failed to update user profile");
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        email: t.Optional(t.String()),
        bio: t.Optional(t.String()),
        avatar: t.Optional(t.String()),
        language: t.Optional(t.String()),
        theme: t.Optional(t.String()),
        notifications: t.Optional(t.Object({})),
        privacy: t.Optional(t.Object({})),
        twoFactor: t.Optional(t.Boolean()),
        defaultPaymentAddress: t.Optional(t.String()),
        paymentAddress: t.Optional(t.String()),
      }),
    }
  )
  .onError(({ error }) => {
    logger.error("Unexpected error in user profile router:", error);
    if (error instanceof AuthError) {
      return { error: error.message, status: error.statusCode };
    }
    return { error: "An unexpected error occurred", status: 500 };
  });

export default userProfileRouter;
