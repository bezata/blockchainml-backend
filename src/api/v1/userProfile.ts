import { Elysia } from "elysia";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import { enhancedRedactSensitiveInfo } from "../../utils/security";

// Performance tracking utility
const createPerformanceTracker = (label: string) => {
  const start = process.hrtime();
  return {
    end: () => {
      const diff = process.hrtime(start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };
};

export const userProfileRouter = new Elysia({ prefix: "/user" })
  .use(authPlugin)
  .get("/profile", async ({ authenticatedUser, store }) => {
    const perf = createPerformanceTracker("get-own-profile");
    const requestLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      const duration = perf.end();
      requestLogger.error("User profile GET - No authenticated user", {
        duration,
      });
      throw new AuthError(401, "Authentication required");
    }

    try {
      const walletAddress = authenticatedUser.walletAddress;
      requestLogger.info("Fetching own profile", {
        userAddress: enhancedRedactSensitiveInfo(
          { address: walletAddress },
          { preserveWalletAddress: true }
        ).address,
      });

      const userProfile = await prisma.user.findUnique({
        where: { walletAddress },
        select: {
          walletAddress: true,
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
          selectedPaymentAddress: true,
          solanaAddress: true,
          linkedinProfileLink: true,
        },
      });

      if (!userProfile) {
        const duration = perf.end();
        requestLogger.warn("User profile not found", {
          userAddress: enhancedRedactSensitiveInfo(
            { address: walletAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
        });
        throw new AuthError(404, "User profile not found");
      }

      const duration = perf.end();
      requestLogger.info("Profile retrieved successfully", {
        userAddress: enhancedRedactSensitiveInfo(
          { address: walletAddress },
          { preserveWalletAddress: true }
        ).address,
        duration,
        fields: Object.keys(userProfile),
      });

      return enhancedRedactSensitiveInfo(userProfile, {
        preserveWalletAddress: true,
      });
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error fetching user profile", {
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
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user profile");
    }
  })
  .get(
    "/profile/:walletAddress",
    async ({ params, authenticatedUser, store }) => {
      const perf = createPerformanceTracker("get-public-profile");
      const requestLogger = (store as any)?.requestLogger || logger;

      try {
        requestLogger.info("Fetching public profile", {
          targetAddress: enhancedRedactSensitiveInfo(
            { address: params.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          requestedBy: authenticatedUser
            ? enhancedRedactSensitiveInfo(
                { address: authenticatedUser.walletAddress },
                { preserveWalletAddress: true }
              ).address
            : "anonymous",
        });

        const profileUser = await prisma.user.findUnique({
          where: { walletAddress: params.walletAddress },
          select: {
            walletAddress: true,
            name: true,
            email: true,
            bio: true,
            avatar: true,
            chainId: true,
            githubProfileLink: true,
            xProfileLink: true,
            discordProfileLink: true,
            privacySettings: true,
            solanaAddress: true,
            linkedinProfileLink: true,
          },
        });

        if (!profileUser) {
          const duration = perf.end();
          requestLogger.warn("Profile not found", {
            targetAddress: enhancedRedactSensitiveInfo(
              { address: params.walletAddress },
              { preserveWalletAddress: true }
            ).address,
            duration,
          });
          throw new AuthError(404, "User not found");
        }

        const isOwnProfile =
          authenticatedUser?.walletAddress === profileUser.walletAddress;
        const privacy = profileUser.privacySettings as {
          profileVisibility?: "public" | "private";
          showEmail?: boolean;
          showSocialLinks?: boolean;
        } | null;
        const isPublic = privacy?.profileVisibility === "public";

        const publicProfile = {
          walletAddress: profileUser.walletAddress,
          name: profileUser.name,
          avatar: profileUser.avatar,
          bio: profileUser.bio,
        };

        if (isOwnProfile || isPublic) {
          const duration = perf.end();
          requestLogger.info("Full profile access granted", {
            targetAddress: enhancedRedactSensitiveInfo(
              { address: params.walletAddress },
              { preserveWalletAddress: true }
            ).address,
            isOwnProfile,
            isPublic,
            duration,
          });

          return {
            ...publicProfile,
            chainId: profileUser.chainId,
            email: privacy?.showEmail ? profileUser.email : undefined,
            githubProfileLink: privacy?.showSocialLinks
              ? profileUser.githubProfileLink
              : undefined,
            xProfileLink: privacy?.showSocialLinks
              ? profileUser.xProfileLink
              : undefined,
            discordProfileLink: privacy?.showSocialLinks
              ? profileUser.discordProfileLink
              : undefined,
            linkedinProfileLink: privacy?.showSocialLinks
              ? profileUser.linkedinProfileLink
              : undefined,
          };
        }

        const duration = perf.end();
        requestLogger.info("Limited profile access granted", {
          targetAddress: enhancedRedactSensitiveInfo(
            { address: params.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
        });

        return enhancedRedactSensitiveInfo(publicProfile, {
          preserveWalletAddress: true,
        });
      } catch (error) {
        const duration = perf.end();
        requestLogger.error("Error fetching public profile", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          targetAddress: enhancedRedactSensitiveInfo(
            { address: params.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
        });
        if (error instanceof AuthError) throw error;
        throw new AuthError(500, "Failed to fetch user profile");
      }
    }
  )
  .onError(({ error, set, store }) => {
    const errorLogger = (store as any)?.requestLogger || logger;

    if (error instanceof AuthError) {
      errorLogger.warn("Auth error in profile router", {
        statusCode: error.statusCode,
        message: error.message,
      });
      set.status = error.statusCode;
      return { error: error.message };
    }

    errorLogger.error("Unexpected error in profile router", {
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

export default userProfileRouter;
