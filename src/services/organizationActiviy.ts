import { logger } from "@/utils/monitor";
import { PrismaClient } from "@prisma/client";

export type ActivityAction =
  | "MEMBER_ADDED"
  | "MEMBER_REMOVED"
  | "ROLE_CREATED"
  | "ROLE_UPDATED"
  | "ROLE_DELETED"
  | "SETTINGS_UPDATED"
  | "SETTINGS_VIEWED"
  | "PROJECT_CREATED"
  | "PROJECT_UPDATED"
  | "PROJECT_DELETED"
  | "DATASET_UPLOADED"
  | "DATASET_DELETED"
  | "ORGANIZATION_ARCHIVED";

export class OrganizationActivityLogger {
  constructor(private prisma: PrismaClient) {}

  async logActivity(
    organizationId: string,
    actorId: string,
    actorRole: string,
    action: ActivityAction,
    details?: Record<string, any>,
    metadata?: Record<string, any>
  ) {
    try {
      const activity = await this.prisma.organizationActivity.create({
        data: {
          organizationId,
          actorId,
          actorRole,
          action,
          details,
          metadata: {
            ...metadata,
            timestamp: new Date().toISOString(),
            userAgent: metadata?.userAgent || "system",
          },
        },
      });

      logger.info(`Organization activity logged: ${action}`, {
        organizationId,
        actorId,
        action,
        activityId: activity.id,
      });

      return activity;
    } catch (error) {
      logger.error("Failed to log organization activity", {
        error,
        organizationId,
        action,
      });
      throw error;
    }
  }

  async getActivities(
    organizationId: string,
    options?: {
      limit?: number;
      offset?: number;
      startDate?: Date;
      endDate?: Date;
      actions?: ActivityAction[];
    }
  ) {
    const {
      limit = 50,
      offset = 0,
      startDate,
      endDate,
      actions,
    } = options || {};

    try {
      const activities = await this.prisma.organizationActivity.findMany({
        where: {
          organizationId,
          createdAt: {
            gte: startDate,
            lte: endDate,
          },
          action: actions ? { in: actions } : undefined,
        },
        orderBy: {
          createdAt: "desc",
        },
        take: limit,
        skip: offset,
      });

      return activities;
    } catch (error) {
      logger.error("Failed to fetch organization activities", {
        error,
        organizationId,
      });
      throw error;
    }
  }
}
