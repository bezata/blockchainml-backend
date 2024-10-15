import { Elysia, t } from "elysia";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
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
};

export const userProfileRouter = new Elysia({ prefix: "/user" })
  .use(authPlugin)
  .get("/profile", async ({ authenticatedUser }) => {
    if (!authenticatedUser) {
      logger.error("User profile GET - No authenticated user");
      throw new AuthError(401, "Authentication required");
    }

    try {
      const userProfile = await prisma.user.findUnique({
        where: { walletAddress: authenticatedUser.walletAddress },
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

      if (!userProfile) {
        logger.warn(
          `User profile not found for ${authenticatedUser.walletAddress}`
        );
        throw new AuthError(404, "User profile not found");
      }

      logger.info(
        `User profile fetched successfully for ${authenticatedUser.walletAddress}`
      );
      return userProfile as UserProfile;
    } catch (error) {
      logger.error(
        `Error fetching user profile for ${authenticatedUser.walletAddress}:`,
        error
      );
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user profile");
    }
  })
  .get("/profile/:walletAddress", async ({ params, authenticatedUser }) => {
    try {
      const profileUser = await prisma.user.findUnique({
        where: { walletAddress: params.walletAddress },
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
        logger.warn(`User not found: ${params.walletAddress}`);
        throw new AuthError(404, "User not found");
      }

      const isOwnProfile =
        authenticatedUser?.walletAddress === profileUser.walletAddress;
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
      logger.error(
        `Error fetching user profile for ${params.walletAddress}:`,
        error
      );
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user profile");
    }
  })
  .patch(
    "/profile",
    async ({ authenticatedUser, body }) => {
      if (!authenticatedUser) {
        logger.error("User profile PATCH - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      try {
        const updatedUser = await prisma.user.update({
          where: { walletAddress: authenticatedUser.walletAddress },
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
        logger.info(
          `User profile updated successfully for ${authenticatedUser.walletAddress}`
        );
        return updatedUser as UserProfile;
      } catch (error) {
        logger.error(
          `Error updating user profile for ${authenticatedUser.walletAddress}:`,
          error
        );
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
