import { Elysia } from "elysia";
import prisma from "@/middleware/prismaclient";
import { logger } from "@/utils/monitor";
import { authPlugin, AuthError } from "@/middleware/authPlugin";
import { enhancedRedactSensitiveInfo } from "@/utils/security";
import {
  UserPrivacySettings,
  NotificationPreferences,
} from "@/types/userProfile/userProfile";

// Cache configuration
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const profileCache = new Map<string, { data: any; timestamp: number }>();

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

// Utility to validate and sanitize profile data
const sanitizeProfileData = (data: any) => {
  // Remove any potentially harmful HTML/scripts
  const sanitize = (str: string | null) =>
    str?.replace(/<[^>]*>/g, "").trim() ?? null;

  return {
    ...data,
    name: sanitize(data.name),
    bio: sanitize(data.bio),
    email: data.email?.toLowerCase().trim(),
    githubProfileLink: data.githubProfileLink?.trim(),
    xProfileLink: data.xProfileLink?.trim(),
    discordProfileLink: data.discordProfileLink?.trim(),
    linkedinProfileLink: data.linkedinProfileLink?.trim(),
  };
};

export const userProfileRouter = new Elysia({ prefix: "/user" })
  .use(authPlugin)

  // Get own profile
  .get("/profile", async ({ authenticatedUser, store }) => {
    const perf = createPerformanceTracker("get-own-profile");
    const requestLogger = (store as any)?.requestLogger || logger;

    requestLogger.info("User profile GET request received", {
      endpoint: "/user/profile",
      requestTime: new Date().toISOString(),
    });

    if (!authenticatedUser) {
      const duration = perf.end();
      requestLogger.error("User profile GET - Authentication failed", {
        duration,
        error: "No authenticated user",
        endpoint: "/user/profile",
      });
      throw new AuthError(401, "Authentication required");
    }

    try {
      const walletAddress = authenticatedUser.walletAddress;
      requestLogger.info("Fetching user profile", {
        walletAddress: enhancedRedactSensitiveInfo(walletAddress),
        endpoint: "/user/profile",
      });

      // Check cache first
      const cached = profileCache.get(walletAddress);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        const duration = perf.end();
        requestLogger.info("User profile GET - Cache hit", {
          duration,
          walletAddress: enhancedRedactSensitiveInfo(walletAddress),
          endpoint: "/user/profile",
        });
        return cached.data;
      }

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
          username: true,
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
          createdAt: true,
          updatedAt: true,
          _count: {
            select: {
              projects: true,
              posts: true,
              comments: true,
              organizationMemberships: true,
            },
          },
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
          endpoint: "/user/profile",
        });
        throw new AuthError(404, "User profile not found");
      }

      const sanitizedProfile = sanitizeProfileData(userProfile);
      const redactedProfile = enhancedRedactSensitiveInfo(sanitizedProfile, {
        preserveWalletAddress: true,
      });

      // Update cache
      profileCache.set(walletAddress, {
        data: redactedProfile,
        timestamp: Date.now(),
      });

      const duration = perf.end();
      requestLogger.info("User profile GET - Success", {
        duration,
        walletAddress: enhancedRedactSensitiveInfo(walletAddress),
        found: !!userProfile,
        endpoint: "/user/profile",
      });

      return redactedProfile;
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("User profile GET - Error", {
        duration,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: "/user/profile",
      });
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user profile");
    }
  })

  // Update own profile
  .patch("/profile", async ({ body, authenticatedUser, store }) => {
    const perf = createPerformanceTracker("update-profile");
    const requestLogger = (store as any)?.requestLogger || logger;

    requestLogger.info("User profile PATCH request received", {
      endpoint: "/user/profile",
      requestTime: new Date().toISOString(),
    });

    if (!authenticatedUser) {
      throw new AuthError(401, "Authentication required");
    }

    try {
      const sanitizedData = sanitizeProfileData(body);
      const walletAddress = authenticatedUser.walletAddress;

      requestLogger.info("Updating user profile", {
        walletAddress: enhancedRedactSensitiveInfo(walletAddress),
        endpoint: "/user/profile",
      });

      const updatedProfile = await prisma.user.update({
        where: { walletAddress },
        data: sanitizedData,
        select: {
          walletAddress: true,
          name: true,
          username: true,
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
          linkedinProfileLink: true,
        },
      });

      // Invalidate cache
      profileCache.delete(walletAddress);

      const duration = perf.end();
      requestLogger.info("User profile PATCH - Success", {
        duration,
        walletAddress: enhancedRedactSensitiveInfo(walletAddress),
        updatedFields: Object.keys(sanitizedData),
        endpoint: "/user/profile",
      });

      return enhancedRedactSensitiveInfo(updatedProfile, {
        preserveWalletAddress: true,
      });
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("User profile PATCH - Error", {
        duration,
        error: error instanceof Error ? error.message : "Unknown error",
        stack: error instanceof Error ? error.stack : undefined,
        endpoint: "/user/profile",
      });
      throw new AuthError(500, "Failed to update user profile");
    }
  })

  // Get public profile
  .get(
    "/profile/:walletAddress",
    async ({ params, authenticatedUser, store }) => {
      const perf = createPerformanceTracker("get-public-profile");
      const requestLogger = (store as any)?.requestLogger || logger;

      requestLogger.info("User public profile GET request received", {
        endpoint: "/user/profile/:walletAddress",
        requestTime: new Date().toISOString(),
      });

      try {
        // Check cache for public profile
        const cacheKey = `public_${params.walletAddress}`;
        const cached = profileCache.get(cacheKey);
        if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
          const duration = perf.end();
          requestLogger.info("User public profile GET - Cache hit", {
            duration,
            walletAddress: enhancedRedactSensitiveInfo(params.walletAddress),
            endpoint: "/user/profile/:walletAddress",
          });
          return cached.data;
        }

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
          endpoint: "/user/profile/:walletAddress",
        });

        const profileUser = await prisma.user.findUnique({
          where: { walletAddress: params.walletAddress },
          select: {
            walletAddress: true,
            name: true,
            username: true,
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
            createdAt: true,
            _count: {
              select: {
                projects: true,
                posts: true,
                comments: true,
              },
            },
          },
        });

        if (!profileUser) {
          throw new AuthError(404, "User not found");
        }

        const isOwnProfile =
          authenticatedUser?.walletAddress === profileUser.walletAddress;
        const privacy = (profileUser.privacySettings || {
          profileVisibility: "public",
          showEmail: false,
          showSocialLinks: false,
          showWalletAddresses: false,
        }) as unknown as UserPrivacySettings;
        const isPublic = privacy.profileVisibility === "public";

        const publicProfile = {
          walletAddress: profileUser.walletAddress,
          name: profileUser.name,
          avatar: profileUser.avatar,
          bio: profileUser.bio,
          createdAt: profileUser.createdAt,
          stats: {
            projects: profileUser._count.projects,
            posts: profileUser._count.posts,
            comments: profileUser._count.comments,
          },
        };

        let profile;
        if (isOwnProfile || isPublic) {
          profile = {
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
            solanaAddress: privacy?.showWalletAddresses
              ? profileUser.solanaAddress
              : undefined,
          };
        } else {
          profile = publicProfile;
        }

        const sanitizedProfile = sanitizeProfileData(profile);
        const redactedProfile = enhancedRedactSensitiveInfo(sanitizedProfile, {
          preserveWalletAddress: true,
        });

        // Update cache
        profileCache.set(cacheKey, {
          data: redactedProfile,
          timestamp: Date.now(),
        });

        const duration = perf.end();
        requestLogger.info("User public profile GET - Success", {
          duration,
          walletAddress: enhancedRedactSensitiveInfo(params.walletAddress),
          found: !!profileUser,
          endpoint: "/user/profile/:walletAddress",
        });

        return redactedProfile;
      } catch (error) {
        const duration = perf.end();
        requestLogger.error("User public profile GET - Error", {
          duration,
          error: error instanceof Error ? error.message : "Unknown error",
          stack: error instanceof Error ? error.stack : undefined,
          endpoint: "/user/profile/:walletAddress",
        });
        if (error instanceof AuthError) throw error;
        throw new AuthError(500, "Failed to fetch user profile");
      }
    }
  )

  .get("/by-username/:username", async ({ params, store }) => {
    const perf = createPerformanceTracker("get-user-by-username");
    const requestLogger = (store as any)?.requestLogger || logger;

    try {
      const user = await prisma.user.findUnique({
        where: { username: params.username },
        select: {
          walletAddress: true,
          username: true,
        },
      });

      if (!user) {
        throw new AuthError(404, "User not found");
      }

      const duration = perf.end();
      requestLogger.info("Username lookup successful", {
        duration,
        username: params.username,
      });

      return user;
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Username lookup failed", {
        duration,
        username: params.username,
        error: error instanceof Error ? error.message : "Unknown error",
      });
      throw error;
    }
  })

  .onError(({ error, set, request, store }) => {
    const errorLogger = (store as any)?.requestLogger || logger;
    errorLogger.error("User profile route error", {
      error: error instanceof Error ? error.message : "Unknown error",
      stack: error instanceof Error ? error.stack : undefined,
   
    });
    set.status = 500;

    return { error: "Internal Server Error" };
  });

export default userProfileRouter;
