import { Elysia, t } from "elysia";
import { PrismaClient, User, Prisma } from "@prisma/client";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import { logger } from "../../utils/monitor";
import { TRPCError } from "@trpc/server";

const prisma = new PrismaClient().$extends({
  query: {
    user: {
      async findUnique({ args, query }) {
        logger.info("Custom findUnique for user profile:", args);
        return query(args);
      },
    },
  },
});

type UserProfile = Omit<User, "apiKey" | "createdAt" | "updatedAt">;
type PublicProfile = Pick<User, "walletAddress" | "name" | "avatar" | "bio">;

const userProfileSchema = t.Object({
  name: t.Optional(t.String()),
  email: t.Optional(t.String({ format: "email" })),
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
      profileVisibility: t.Enum({ public: "public", private: "private" }),
      showEmail: t.Boolean(),
    })
  ),
  twoFactor: t.Optional(t.Boolean()),
  defaultPaymentAddress: t.Optional(t.String()),
  paymentAddress: t.Optional(t.String()),
});

export const userProfileRouter = new Elysia({ prefix: "/user" })
  .use(authPlugin)
  .get("/profile", async ({ authenticatedUser }) => {
    logger.info("userProfileRouter - GET /profile - User:", authenticatedUser);
    if (!authenticatedUser) {
      throw new AuthError(401, "User not authenticated");
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
        throw new AuthError(404, "User profile not found");
      }

      return userProfile as UserProfile;
    } catch (error) {
      logger.error("Error fetching user profile:", error);
      if (error instanceof AuthError) {
        throw error;
      }
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
        throw new AuthError(404, "User not found");
      }

      const isOwnProfile =
        authenticatedUser?.walletAddress === profileUser.walletAddress;
      const privacy = profileUser.privacy as {
        profileVisibility?: "public" | "private";
      };
      const isPublic = privacy?.profileVisibility === "public";

      const publicProfile: PublicProfile = {
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
      logger.error("Error fetching user profile:", error);
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user profile");
    }
  })
  .patch(
    "/profile",
    async ({ authenticatedUser, body }) => {
      if (!authenticatedUser) {
        throw new AuthError(401, "User not authenticated");
      }
      try {
        const validatedBody = userProfileSchema.parse(body);
        const updatedUser = await prisma.user.update({
          where: { walletAddress: authenticatedUser.walletAddress },
          data: validatedBody,
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
        logger.error("Error updating user profile:", error);
        if (error instanceof Prisma.PrismaClientKnownRequestError) {
          if (error.code === "P2002") {
            throw new AuthError(400, "This email is already in use");
          }
        }
        if (error instanceof TRPCError) {
          throw new AuthError(400, error.message);
        }
        throw new AuthError(500, "Failed to update user profile");
      }
    },
    {
      body: userProfileSchema,
    }
  )
  .onError(({ error, set }) => {
    logger.error("Error in userProfileRouter:", error);
    if (error instanceof AuthError) {
      set.status = error.statusCode;
      return { error: error.message };
    }
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default userProfileRouter;
