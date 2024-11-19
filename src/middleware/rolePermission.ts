import { Elysia } from "elysia";
import prisma from "./prismaclient";
import { logger } from "../utils/monitor";
import { AuthError } from "./authPlugin";

type Permission =
  | "canInviteMembers"
  | "canManageRoles"
  | "canManageMembers"
  | "canManageSettings"
  | "canManageProjects"
  | "canManageDatasets"
  | "canDeleteOrganization"
  | "canManageBilling"
  | "canViewAnalytics"
  | "canManageRevenue";

export const checkPermission = (permission: Permission) => {
  return new Elysia().derive(async ({ params, query, store }) => {
    const organizationId =
      params?.organizationId || params?.id || query?.organizationId;

    if (!organizationId) {
      throw new AuthError(400, "Organization ID is required");
    }

    const authenticatedUser = (store as any).authenticatedUser;
    if (!authenticatedUser) {
      throw new AuthError(401, "Authentication required");
    }

    const user = await prisma.user.findUnique({
      where: { walletAddress: authenticatedUser.walletAddress },
      select: { id: true },
    });

    if (!user) {
      throw new AuthError(401, "User not found");
    }

    const membership = await prisma.organizationMember.findFirst({
      where: {
        organizationId: organizationId as string,
        userId: user.id,
      },
      include: {
        role: true,
      },
    });

    if (!membership) {
      throw new AuthError(403, "Not a member of this organization");
    }

    const permissions = membership.role.permissions as Record<
      Permission,
      boolean
    >;
    if (!permissions[permission]) {
      throw new AuthError(403, `Missing required permission: ${permission}`);
    }

    return {
      organizationMember: membership,
    };
  });
};
