import { Elysia, t } from "elysia";
import prisma from "@/middleware/prismaclient";
import { logger } from "../../utils/monitor";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import { enhancedRedactSensitiveInfo } from "../../utils/security";
import { OrganizationActivityLogger } from "@/services/organizationActiviy";
import { ActivityAction, OrganizationPermissions } from "@/types/types";
import { PrismaClient } from "@prisma/client";
import { OrganizationData } from "@/types/organization/setting";

const activityLogger = new OrganizationActivityLogger(
  prisma as unknown as PrismaClient
);
const CACHE_TTL = 5 * 60 * 1000;
const settingsCache = new Map<string, { data: any; timestamp: number }>();

const createPerformanceTracker = (label: string) => {
  const start = process.hrtime();
  return {
    end: () => {
      const diff = process.hrtime(start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };
};

const sanitizeOrgData = (data: OrganizationData): OrganizationData => {
  const sanitize = (str: string | null | undefined) =>
    str?.replace(/<[^>]*>/g, "").trim() ?? null;

  return {
    ...data,
    name: sanitize(data.name) || data.name,
    description: sanitize(data.description),
    websiteLink: data.websiteLink?.trim(),
    linkedinOrgLink: data.linkedinOrgLink?.trim(),
    discordServerLink: data.discordServerLink?.trim(),
    twitterOrgLink: data.twitterOrgLink?.trim(),
    githubOrgLink: data.githubOrgLink?.trim(),
  };
};

export const organizationSettingsRouter = new Elysia({
  prefix: "/organization/settings",
})
  .use(authPlugin)
  .get("/:id", async ({ params, authenticatedUser, store }) => {
    const perf = createPerformanceTracker("get-org-settings");
    const requestLogger = (store as any)?.requestLogger || logger;

    try {
      const cached = settingsCache.get(params.id);
      if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return cached.data;
      }

      const user = await prisma.user.findUniqueOrThrow({
        where: { walletAddress: authenticatedUser.walletAddress },
        select: { id: true },
      });

      const membership = await prisma.organizationMember.findFirst({
        where: {
          organizationId: params.id,
          userId: authenticatedUser.id,
        },
        include: { role: true },
      });

      if (!membership) {
        throw new AuthError(403, "Not a member of this organization");
      }

      const organization = await prisma.organization.findUniqueOrThrow({
        where: { id: params.id },
        include: {
          members: {
            include: {
              user: {
                select: {
                  id: true,
                  name: true,
                  avatar: true,
                  walletAddress: true,
                },
              },
              role: true,
            },
          },
        },
      });

      const permissions = membership.role
        .permissions as unknown as OrganizationPermissions;
      const response = {
        general: {
          name: organization.name,
          description: organization.description,
          badge: organization.badge,
          websiteLink: organization.websiteLink,
          linkedinOrgLink: organization.linkedinOrgLink,
          discordServerLink: organization.discordServerLink,
          twitterOrgLink: organization.twitterOrgLink,
          githubOrgLink: organization.githubOrgLink,
          organizationLogo: organization.organizationLogo,
          visibility: organization.visibility,
        },
        revenueSharing: organization.revenueSharing,
        members: organization.members.map((m) => ({
          id: m.user.id,
          name: m.user.name,
          avatar: m.user.avatar,
          walletAddress: m.user.walletAddress,
          role: m.role.name,
          permissions: m.role.permissions as unknown as OrganizationPermissions,
        })),
        userRole: membership.role.name,
        userPermissions: permissions,
      };

      settingsCache.set(params.id, {
        data: response,
        timestamp: Date.now(),
      });

      await activityLogger.logActivity(
        params.id,
        authenticatedUser.id,
        membership.role.name,
        ActivityAction.SETTINGS_VIEWED,
        { timestamp: new Date().toISOString() }
      );

      const duration = perf.end();
      requestLogger.info("Organization settings retrieved", {
        orgId: params.id,
        duration,
        fields: Object.keys(response),
      });

      return response;
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error fetching organization settings", {
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
      throw error;
    }
  })

  .put("/:id", async ({ params, body, authenticatedUser, request }) => {
    const perf = createPerformanceTracker("update-org-settings");
    const requestLogger = logger;

    try {
      const user = await prisma.user.findUniqueOrThrow({
        where: { walletAddress: authenticatedUser.walletAddress },
        select: { id: true, name: true },
      });

      const membership = await prisma.organizationMember.findFirst({
        where: {
          organizationId: params.id,
          userId: authenticatedUser.id,
        },
        include: { role: true },
      });

      const permissions = membership?.role
        .permissions as unknown as OrganizationPermissions;

      if (!membership || !permissions.canManageSettings) {
        throw new AuthError(403, "Insufficient permissions");
      }

      const sanitizedData = sanitizeOrgData(body as OrganizationData);
      const previousSettings = await prisma.organization.findUniqueOrThrow({
        where: { id: params.id },
      });

      const updatedOrg = await prisma.organization.update({
        where: { id: params.id },
        data: sanitizedData,
      });

      settingsCache.delete(params.id);

      const changes = Object.entries(sanitizedData).reduce<
        Record<string, { from: any; to: any }>
      >((acc, [key, value]) => {
        if (previousSettings[key as keyof typeof previousSettings] !== value) {
          acc[key] = {
            from: previousSettings[key as keyof typeof previousSettings],
            to: value,
          };
        }
        return acc;
      }, {});

      await activityLogger.logActivity(
        params.id,
        user.id,
        membership.role.name,
        ActivityAction.SETTINGS_UPDATED,
        {
          changes,
          updatedFields: Object.keys(changes),
        }
      );

      if (sanitizedData.name || sanitizedData.visibility) {
        await fetch("/api/notifications", {
          method: "POST",
          body: JSON.stringify({
            recipientId: user.id,
            type: "ORGANIZATION_UPDATE",
            title: "Organization Settings Updated",
            message: `${membership.role.name} ${user.name} updated organization settings`,
            data: { changes },
            sourceType: "ORGANIZATION",
            sourceId: params.id,
          }),
        });
      }

      const duration = perf.end();
      requestLogger.info("Organization settings updated", {
        orgId: params.id,
        duration,
        updatedFields: Object.keys(changes),
      });

      return updatedOrg;
    } catch (error) {
      const duration = perf.end();
      requestLogger.error("Error updating organization settings", {
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
      throw error;
    }
  });

export default organizationSettingsRouter;
