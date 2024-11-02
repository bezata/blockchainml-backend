import { Elysia } from "elysia";
import prisma from "../../middleware/prismaclient";
import { logger } from "../../utils/monitor";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import { enhancedRedactSensitiveInfo } from "../../utils/security";

// Types
type OrganizationRole = "ADMIN" | "MEMBER";

interface CreateOrganizationBody {
  name: string;
  description?: string;
  badge?: string;
  websiteLink?: string;
  linkedinOrgLink?: string;
  discordServerLink?: string;
  twitterOrgLink?: string;
  githubOrgLink?: string;
}

interface UpdateOrganizationBody extends Partial<CreateOrganizationBody> {}

// Utilities
const createPerformanceTracker = (label: string) => {
  const start = process.hrtime();
  return {
    end: () => {
      const diff = process.hrtime(start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };
};

// Authorization helper
const checkUserOrganizationRole = async (
  userId: string,
  organizationId: string,
  requiredRole?: OrganizationRole
): Promise<boolean> => {
  const membership = await prisma.organizationMember.findUnique({
    where: {
      organizationId_userId: {
        organizationId,
        userId,
      },
    },
  });

  if (!membership) return false;
  if (requiredRole && membership.role !== requiredRole) return false;
  return true;
};

export const organizationProfileRouter = new Elysia({ prefix: "/organization" })
  .use(authPlugin)
  // Get organization profile
  .get("/profile/:id", async ({ params, authenticatedUser, store }) => {
    const perf = createPerformanceTracker("get-organization-profile");
    const requestLogger = (store as any)?.requestLogger || logger;

    try {
      requestLogger.info("Fetching organization profile", {
        organizationId: params.id,
        requestedBy: authenticatedUser
          ? enhancedRedactSensitiveInfo(
              { address: authenticatedUser.walletAddress },
              { preserveWalletAddress: true }
            ).address
          : "anonymous",
      });

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
            },
          },
        },
      });

      if (!organization) {
        const duration = perf.end();
        requestLogger.warn("Organization profile not found", {
          organizationId: params.id,
          duration,
        });
        throw new AuthError(404, "Organization not found");
      }

      const duration = perf.end();
      requestLogger.info("Organization profile retrieved successfully", {
        organizationId: params.id,
        duration,
        fields: Object.keys(organization),
      });

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
        createdAt: organization.createdAt,
        updatedAt: organization.updatedAt,
        members: organization.members.map((member) => ({
          role: member.role,
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
      };
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error fetching organization profile", {
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
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch organization profile");
    }
  })

  // Get user's organizations
  .get("/my-organizations", async ({ authenticatedUser, store }) => {
    const perf = createPerformanceTracker("get-user-organizations");
    const requestLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      const duration = perf.end();
      requestLogger.error("Organizations GET - No authenticated user", {
        duration,
      });
      throw new AuthError(401, "Authentication required");
    }

    try {
      const user = await prisma.user.findUnique({
        where: { walletAddress: authenticatedUser.walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new AuthError(404, "User not found");
      }

      const userOrganizations = await prisma.organizationMember.findMany({
        where: {
          userId: user.id,
        },
        include: {
          organization: {
            select: {
              id: true,
              name: true,
              description: true,
              badge: true,
              websiteLink: true,
              linkedinOrgLink: true,
              discordServerLink: true,
              twitterOrgLink: true,
              githubOrgLink: true,
              createdAt: true,
              updatedAt: true,
              _count: {
                select: {
                  members: true,
                },
              },
            },
          },
        },
        orderBy: {
          joinedAt: "desc",
        },
      });

      const duration = perf.end();
      requestLogger.info("User organizations retrieved successfully", {
        userAddress: enhancedRedactSensitiveInfo(
          { address: authenticatedUser.walletAddress },
          { preserveWalletAddress: true }
        ).address,
        organizationCount: userOrganizations.length,
        duration,
      });

      return userOrganizations.map((membership) => ({
        ...membership.organization,
        memberCount: membership.organization._count.members,
        role: membership.role,
        joinedAt: membership.joinedAt,
      }));
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error fetching user organizations", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        userAddress: enhancedRedactSensitiveInfo(
          { address: authenticatedUser.walletAddress },
          { preserveWalletAddress: true }
        ).address,
        duration,
      });
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to fetch user organizations");
    }
  })

  // Create new organization
  .post("/", async ({ body, authenticatedUser, store }) => {
    const perf = createPerformanceTracker("create-organization");
    const requestLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      throw new AuthError(401, "Authentication required");
    }

    try {
      const user = await prisma.user.findUnique({
        where: { walletAddress: authenticatedUser.walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new AuthError(404, "User not found");
      }

      const organization = await prisma.$transaction(async (tx) => {
        // Create organization
        const newOrg = await tx.organization.create({
          data: body as CreateOrganizationBody,
        });

        // Add creator as admin
        await tx.organizationMember.create({
          data: {
            organizationId: newOrg.id,
            userId: user.id,
            role: "ADMIN",
          },
        });

        return newOrg;
      });

      const duration = perf.end();
      requestLogger.info("Organization created successfully", {
        organizationId: organization.id,
        createdBy: enhancedRedactSensitiveInfo(
          { address: authenticatedUser.walletAddress },
          { preserveWalletAddress: true }
        ).address,
        duration,
      });

      return organization;
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error creating organization", {
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
      throw new AuthError(500, "Failed to create organization");
    }
  })

  // Update organization
  .patch("/:id", async ({ params, body, authenticatedUser, store }) => {
    const perf = createPerformanceTracker("update-organization");
    const requestLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      throw new AuthError(401, "Authentication required");
    }

    try {
      const user = await prisma.user.findUnique({
        where: { walletAddress: authenticatedUser.walletAddress },
        select: { id: true },
      });

      if (!user) {
        throw new AuthError(404, "User not found");
      }

      const hasAccess = await checkUserOrganizationRole(
        user.id,
        params.id,
        "ADMIN"
      );
      if (!hasAccess) {
        throw new AuthError(
          403,
          "Only organization admins can update organization details"
        );
      }

      const organization = await prisma.organization.update({
        where: { id: params.id },
        data: body as UpdateOrganizationBody,
      });

      const duration = perf.end();
      requestLogger.info("Organization updated successfully", {
        organizationId: organization.id,
        updatedBy: enhancedRedactSensitiveInfo(
          { address: authenticatedUser.walletAddress },
          { preserveWalletAddress: true }
        ).address,
        duration,
      });

      return organization;
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error updating organization", {
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
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to update organization");
    }
  })

  // Add member to organization
  .post("/:id/members", async ({ params, body, authenticatedUser, store }) => {
    type AddMemberBody = {
      walletAddress: string;
      role?: OrganizationRole;
    };

    const requestBody = body as AddMemberBody;

    const perf = createPerformanceTracker("add-organization-member");
    const requestLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      throw new AuthError(401, "Authentication required");
    }

    try {
      const admin = await prisma.user.findUnique({
        where: { walletAddress: authenticatedUser.walletAddress },
        select: { id: true },
      });

      if (!admin) {
        throw new AuthError(404, "Admin user not found");
      }

      const hasAccess = await checkUserOrganizationRole(
        admin.id,
        params.id,
        "ADMIN"
      );
      if (!hasAccess) {
        throw new AuthError(403, "Only organization admins can add members");
      }

      const newMember = await prisma.user.findUnique({
        where: { walletAddress: requestBody.walletAddress },
        select: { id: true },
      });

      if (!newMember) {
        throw new AuthError(404, "Member user not found");
      }

      const membership = await prisma.organizationMember.create({
        data: {
          organizationId: params.id,
          userId: newMember.id,
          role: requestBody.role || "MEMBER",
        },
        include: {
          user: {
            select: {
              walletAddress: true,
              name: true,
              avatar: true,
            },
          },
        },
      });

      const duration = perf.end();
      requestLogger.info("Organization member added successfully", {
        organizationId: params.id,
        memberAddress: enhancedRedactSensitiveInfo(
          { address: requestBody.walletAddress },
          { preserveWalletAddress: true }
        ).address,
        addedBy: enhancedRedactSensitiveInfo(
          { address: authenticatedUser.walletAddress },
          { preserveWalletAddress: true }
        ).address,
        duration,
      });

      return {
        role: membership.role,
        joinedAt: membership.joinedAt,
        user: {
          walletAddress: enhancedRedactSensitiveInfo(
            { address: membership.user.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          name: membership.user.name,
          avatar: membership.user.avatar,
        },
      };
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error adding organization member", {
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
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to add organization member");
    }
  })

  // Remove member from organization
  .delete(
    "/:id/members/:walletAddress",
    async ({ params, authenticatedUser, store }) => {
      const perf = createPerformanceTracker("remove-organization-member");
      const requestLogger = (store as any)?.requestLogger || logger;

      if (!authenticatedUser) {
        throw new AuthError(401, "Authentication required");
      }

      try {
        const admin = await prisma.user.findUnique({
          where: { walletAddress: authenticatedUser.walletAddress },
          select: { id: true },
        });

        if (!admin) {
          throw new AuthError(404, "Admin user not found");
        }

        const hasAccess = await checkUserOrganizationRole(
          admin.id,
          params.id,
          "ADMIN"
        );
        if (!hasAccess) {
          throw new AuthError(
            403,
            "Only organization admins can remove members"
          );
        }

        const memberToRemove = await prisma.user.findUnique({
          where: { walletAddress: params.walletAddress },
          select: { id: true },
        });

        if (!memberToRemove) {
          throw new AuthError(404, "Member user not found");
        }

        await prisma.organizationMember.delete({
          where: {
            organizationId_userId: {
              organizationId: params.id,
              userId: memberToRemove.id,
            },
          },
        });

        const duration = perf.end();
        requestLogger.info("Organization member removed successfully", {
          organizationId: params.id,
          memberAddress: enhancedRedactSensitiveInfo(
            { address: params.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          removedBy: enhancedRedactSensitiveInfo(
            { address: authenticatedUser.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
        });

        return { success: true };
      } catch (error) {
        const duration = perf.end();
        requestLogger.error("Error removing organization member", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          organizationId: params.id,
          memberAddress: params.walletAddress,
          duration,
        });
        if (error instanceof AuthError) throw error;
        throw new AuthError(500, "Failed to remove organization member");
      }
    }
  )

  // Update member role
  .patch(
    "/:id/members/:walletAddress/role",
    async ({ params, body, authenticatedUser, store }) => {
      type UpdateRoleBody = {
        role: OrganizationRole;
      };
      const requestBody = body as UpdateRoleBody;

      const perf = createPerformanceTracker("update-member-role");
      const requestLogger = (store as any)?.requestLogger || logger;

      if (!authenticatedUser) {
        throw new AuthError(401, "Authentication required");
      }

      try {
        const admin = await prisma.user.findUnique({
          where: { walletAddress: authenticatedUser.walletAddress },
          select: { id: true },
        });

        if (!admin) {
          throw new AuthError(404, "Admin user not found");
        }

        const hasAccess = await checkUserOrganizationRole(
          admin.id,
          params.id,
          "ADMIN"
        );
        if (!hasAccess) {
          throw new AuthError(
            403,
            "Only organization admins can update member roles"
          );
        }

        const memberToUpdate = await prisma.user.findUnique({
          where: { walletAddress: params.walletAddress },
          select: { id: true },
        });

        if (!memberToUpdate) {
          throw new AuthError(404, "Member user not found");
        }

        const updatedMembership = await prisma.organizationMember.update({
          where: {
            organizationId_userId: {
              organizationId: params.id,
              userId: memberToUpdate.id,
            },
          },
          data: {
            role: requestBody.role,
          },
          include: {
            user: {
              select: {
                walletAddress: true,
                name: true,
                avatar: true,
              },
            },
          },
        });

        const duration = perf.end();
        requestLogger.info("Organization member role updated successfully", {
          organizationId: params.id,
          memberAddress: enhancedRedactSensitiveInfo(
            { address: params.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          newRole: requestBody.role,
          updatedBy: enhancedRedactSensitiveInfo(
            { address: authenticatedUser.walletAddress },
            { preserveWalletAddress: true }
          ).address,
          duration,
        });

        return {
          role: updatedMembership.role,
          joinedAt: updatedMembership.joinedAt,
          user: {
            walletAddress: enhancedRedactSensitiveInfo(
              { address: updatedMembership.user.walletAddress },
              { preserveWalletAddress: true }
            ).address,
            name: updatedMembership.user.name,
            avatar: updatedMembership.user.avatar,
          },
        };
      } catch (error) {
        const duration = perf.end();
        requestLogger.error("Error updating member role", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          organizationId: params.id,
          memberAddress: params.walletAddress,
          duration,
        });
        if (error instanceof AuthError) throw error;
        throw new AuthError(500, "Failed to update member role");
      }
    }
  )

  // Delete organization
  .delete("/:id", async ({ params, authenticatedUser, store }) => {
    const perf = createPerformanceTracker("delete-organization");
    const requestLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      throw new AuthError(401, "Authentication required");
    }

    try {
      const admin = await prisma.user.findUnique({
        where: { walletAddress: authenticatedUser.walletAddress },
        select: { id: true },
      });

      if (!admin) {
        throw new AuthError(404, "Admin user not found");
      }

      const hasAccess = await checkUserOrganizationRole(
        admin.id,
        params.id,
        "ADMIN"
      );
      if (!hasAccess) {
        throw new AuthError(
          403,
          "Only organization admins can delete the organization"
        );
      }

      // Delete organization and all related data in a transaction
      await prisma.$transaction(async (tx) => {
        // Delete all member associations
        await tx.organizationMember.deleteMany({
          where: { organizationId: params.id },
        });

        // Delete the organization
        await tx.organization.delete({
          where: { id: params.id },
        });
      });

      const duration = perf.end();
      requestLogger.info("Organization deleted successfully", {
        organizationId: params.id,
        deletedBy: enhancedRedactSensitiveInfo(
          { address: authenticatedUser.walletAddress },
          { preserveWalletAddress: true }
        ).address,
        duration,
      });

      return { success: true };
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error deleting organization", {
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
      if (error instanceof AuthError) throw error;
      throw new AuthError(500, "Failed to delete organization");
    }
  })

  // Search organizations
  .get("/search", async ({ query, store }) => {
    const perf = createPerformanceTracker("search-organizations");
    const requestLogger = (store as any)?.requestLogger || logger;

    try {
      const searchQuery = query.q as string;
      const limit = Number(query.limit) || 10;
      const offset = Number(query.offset) || 0;

      const organizations = await prisma.organization.findMany({
        where: {
          OR: [
            { name: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
        include: {
          _count: {
            select: {
              members: true,
            },
          },
        },
        take: limit,
        skip: offset,
        orderBy: {
          name: "asc",
        },
      });

      const total = await prisma.organization.count({
        where: {
          OR: [
            { name: { contains: searchQuery, mode: "insensitive" } },
            { description: { contains: searchQuery, mode: "insensitive" } },
          ],
        },
      });

      const duration = perf.end();
      requestLogger.info("Organizations search completed", {
        query: searchQuery,
        resultCount: organizations.length,
        total,
        duration,
      });

      return {
        organizations: organizations.map((org) => ({
          ...org,
          memberCount: org._count.members,
        })),
        total,
        limit,
        offset,
      };
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error searching organizations", {
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
      throw new AuthError(500, "Failed to search organizations");
    }
  })

  // Global error handler
  .onError(({ error, set, store }) => {
    const errorLogger = (store as any)?.requestLogger || logger;

    if (error instanceof AuthError) {
      errorLogger.warn("Auth error in organization router", {
        statusCode: error.statusCode,
        message: error.message,
      });
      set.status = error.statusCode;
      return { error: error.message };
    }

    errorLogger.error("Unexpected error in organization router", {
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

export default organizationProfileRouter;
