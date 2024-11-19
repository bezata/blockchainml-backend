export interface OrganizationPermissions {
  canInviteMembers: boolean;
  canManageRoles: boolean;
  canManageMembers: boolean;
  canManageSettings: boolean;
  canManageProjects: boolean;
  canManageDatasets: boolean;
  canDeleteOrganization: boolean;
  canManageBilling: boolean;
  canViewAnalytics: boolean;
  canManageRevenue: boolean;
}

export interface OrganizationRole {
  id: string;
  name: string;
  permissions: OrganizationPermissions;
  organizationId: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface UpdateRoleBody {
  roleId: string;
}

export interface NotificationSettingsBody {
  emailNotifications: boolean;
  memberUpdates: boolean;
  projectUpdates: boolean;
  billingUpdates: boolean;
}

export enum ActivityAction {
  SETTINGS_VIEWED = "SETTINGS_VIEWED",
  SETTINGS_UPDATED = "SETTINGS_UPDATED",
  MEMBER_ROLE_UPDATED = "MEMBER_ROLE_UPDATED",
  NOTIFICATION_SETTINGS_UPDATED = "NOTIFICATION_SETTINGS_UPDATED",
  MEMBER_UPDATED = "MEMBER_UPDATED",
  PROJECT_UPDATED = "PROJECT_UPDATED",
  BILLING_UPDATED = "BILLING_UPDATED",
  ANALYTICS_VIEWED = "ANALYTICS_VIEWED",
  REVENUE_VIEWED = "REVENUE_VIEWED",
}
