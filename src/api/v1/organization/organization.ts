import { Elysia } from "elysia";
import prisma from "../../../middleware/prismaclient";
import { logger } from "../../../utils/monitor";
import { enhancedRedactSensitiveInfo } from "../../../utils/security";
import { createPerformanceTracker } from "../../../index";

export const publicOrganizationRouter = new Elysia({ prefix: "/organization" })
  .get("/public/:id", async ({ params, store }) => {
    const perf = createPerformanceTracker("get-public-organization-profile");
    const requestLogger = (store as any)?.requestLogger || logger;

    try {
      const organization = await prisma.organization.findUnique({
        where: { id: params.id },
        include: {
          members: {
            include: {
              user: {
                select: {
                  walletAddress: true,
                  name: true,
                  avatar: true,
                },
              },
              role: true,
            },
          },
          followers: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                },
              },
            },
          },
          projects: {
            where: {
              visibility: "PUBLIC",
            },
            select: {
              id: true,
              name: true,
              description: true,
              status: true,
              createdAt: true,
            },
          },
          _count: {
            select: {
              members: true,
              projects: true,
              followers: true,
            },
          },
        },
      });

      if (!organization) {
        return {
          error: "Organization not found",
          status: 404,
        };
      }

      const duration = perf.end();
      requestLogger.info("Public organization profile retrieved", {
        organizationId: params.id,
        duration,
      });

      // Return sanitized and formatted data
      return {
        id: organization.id,
        name: organization.name,
        description: organization.description,
        badge: organization.badge,
        websiteLink: organization.websiteLink,
        linkedinOrgLink: organization.linkedinOrgLink,
        discordServerLink: organization.discordServerLink,
        twitterOrgLink: organization.twitterOrgLink,
        githubOrgLink: organization.githubOrgLink,
        organizationLogo: organization.organizationLogo,
        createdAt: organization.createdAt,
        stats: {
          memberCount: organization._count.members,
          projectCount: organization._count.projects,
          followerCount: organization._count.followers,
        },
        followers: organization.followers.map((follower: any) => ({
          userId: follower.user.id,
          name: follower.user.name,
          avatar: follower.user.avatar,
          followedAt: follower.followedAt,
        })),
        members: organization.members.map((member: any) => ({
          role: member.role.name,
          joinedAt: member.joinedAt,
          user: {
            walletAddress: enhancedRedactSensitiveInfo(
              { address: member.user.walletAddress },
              { preserveWalletAddress: true }
            ).address,
            name: member.user.name,
            avatar: member.user.avatar,
          },
        })),
        projects: organization.projects.map((project: any) => ({
          id: project.id,
          name: project.name,
          description: project.description,
          status: project.status,
          createdAt: project.createdAt,
        })),
      };
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error fetching public organization profile", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        organizationId: params.id,
        duration,
      });

      return {
        error: "Failed to fetch organization profile",
        status: 500,
      };
    }
  })

  // Get list of public organizations with optional search/filter
  .get("/public", async ({ query, store }) => {
    const perf = createPerformanceTracker("list-public-organizations");
    const requestLogger = (store as any)?.requestLogger || logger;

    try {
      const page = Number(query.page) || 1;
      const limit = Number(query.limit) || 10;
      const search = (query.search as string) || "";

      const skip = (page - 1) * limit;

      const [organizations, total] = await Promise.all([
        prisma.organization.findMany({
          where: {
            OR: search
              ? [
                  { name: { contains: search, mode: "insensitive" } },
                  { description: { contains: search, mode: "insensitive" } },
                ]
              : undefined,
          },
          select: {
            id: true,
            name: true,
            description: true,
            badge: true,
            organizationLogo: true,
            createdAt: true,
            _count: {
              select: {
                members: true,
                projects: true,
                followers: true,
              },
            },
          },
          take: limit,
          skip,
          orderBy: {
            createdAt: "desc",
          },
        }),
        prisma.organization.count({
          where: {
            OR: search
              ? [
                  { name: { contains: search, mode: "insensitive" } },
                  { description: { contains: search, mode: "insensitive" } },
                ]
              : undefined,
          },
        }),
      ]);

      const duration = perf.end();
      requestLogger.info("Public organizations list retrieved", {
        page,
        limit,
        search: search || "none",
        count: organizations.length,
        total,
        duration,
      });

      return {
        organizations: organizations.map((org: any) => ({
          id: org.id,
          name: org.name,
          description: org.description,
          badge: org.badge,
          organizationLogo: org.organizationLogo,
          createdAt: org.createdAt,
          stats: {
            memberCount: org._count.members,
            projectCount: org._count.projects,
            followerCount: org._count.followers,
          },
        })),
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
          hasMore: page * limit < total,
        },
      };
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error fetching public organizations list", {
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

      return {
        error: "Failed to fetch organizations",
        status: 500,
      };
    }
  });

export default publicOrganizationRouter;
