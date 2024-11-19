import { logger } from "@/utils/monitor";
import { PrismaClient } from "@prisma/client";

export enum NotificationType {
  ORGANIZATION_UPDATE = "ORGANIZATION_UPDATE",
  ROLE_ASSIGNED = "ROLE_ASSIGNED",
  PROJECT_UPDATE = "PROJECT_UPDATE",
  MEMBER_JOINED = "MEMBER_JOINED",
  MEMBER_LEFT = "MEMBER_LEFT",
  SETTINGS_UPDATED = "SETTINGS_UPDATED",
  MENTION = "MENTION",
  REVENUE_SHARE_UPDATE = "REVENUE_SHARE_UPDATE",
  BILLING_UPDATE = "BILLING_UPDATE",
}

export enum SourceType {
  ORGANIZATION = "ORGANIZATION",
  PROJECT = "PROJECT",
  SYSTEM = "SYSTEM",
  USER = "USER",
}

interface NotificationPreferences {
  email: boolean;
  push: boolean;
  discord: boolean;
  browser: boolean;
  marketingEmails: boolean;
  [NotificationType.ORGANIZATION_UPDATE]: boolean;
  [NotificationType.ROLE_ASSIGNED]: boolean;
  [NotificationType.PROJECT_UPDATE]: boolean;
  [NotificationType.MEMBER_JOINED]: boolean;
  [NotificationType.MEMBER_LEFT]: boolean;
  [NotificationType.SETTINGS_UPDATED]: boolean;
  [NotificationType.MENTION]: boolean;
  [NotificationType.REVENUE_SHARE_UPDATE]: boolean;
  [NotificationType.BILLING_UPDATE]: boolean;
}

export class UserNotificationService {
  constructor(private prisma: PrismaClient) {}

  async createNotification(
    userId: string,
    type: NotificationType,
    title: string,
    message: string,
    sourceType: SourceType,
    sourceId?: string,
    data?: Record<string, any>
  ) {
    try {
      const user = await this.prisma.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          notificationPreferences: true,
        },
      });

      const preferences =
        user.notificationPreferences as unknown as NotificationPreferences;

      if (preferences?.[type] === false) {
        logger.info("Notification skipped due to preferences", {
          userId,
          type,
        });
        return;
      }

      const notification = await this.prisma.userNotification.create({
        data: {
          userId,
          type,
          title,
          message,
          sourceType,
          sourceId,
          data,
          isRead: false,
        },
      });

      //@ts-ignore: TODO
      if (global.wss && user.email) {
        this.sendWebSocketNotification(userId, {
          id: notification.id,
          type,
          title,
          message,
          data,
        });
      }

      if (preferences?.email && user.email) {
        await this.sendEmailNotification(
          user.email,
          type,
          title,
          message,
          data
        );
      }

      logger.info("Notification created", {
        userId,
        type,
        notificationId: notification.id,
      });

      return notification;
    } catch (error) {
      logger.error("Failed to create notification", { error, userId, type });
      throw error;
    }
  }

  private async sendEmailNotification(
    email: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    logger.info("Email notification queued", { email, type });
  }

  private sendWebSocketNotification(
    userId: string,
    notification: Record<string, any>
  ) {
    logger.info("WebSocket notification sent", { userId });
  }

  async getNotifications(
    userId: string,
    options?: {
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
      sourceType?: SourceType;
    }
  ) {
    try {
      return await this.prisma.userNotification.findMany({
        where: {
          userId,
          ...(options?.unreadOnly ? { isRead: false } : {}),
          ...(options?.sourceType ? { sourceType: options.sourceType } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: options?.limit ?? 50,
        skip: options?.offset ?? 0,
      });
    } catch (error) {
      logger.error("Failed to fetch notifications", { error, userId });
      throw error;
    }
  }

  async markAsRead(notificationId: string, userId: string) {
    try {
      return await this.prisma.userNotification.update({
        where: {
          id: notificationId,
          userId,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    } catch (error) {
      logger.error("Failed to mark as read", { error, notificationId, userId });
      throw error;
    }
  }

  async markAllAsRead(userId: string, sourceType?: SourceType) {
    try {
      await this.prisma.userNotification.updateMany({
        where: {
          userId,
          isRead: false,
          ...(sourceType ? { sourceType } : {}),
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    } catch (error) {
      logger.error("Failed to mark all as read", { error, userId });
      throw error;
    }
  }

  async getUnreadCount(userId: string, sourceType?: SourceType) {
    try {
      return await this.prisma.userNotification.count({
        where: {
          userId,
          isRead: false,
          ...(sourceType ? { sourceType } : {}),
        },
      });
    } catch (error) {
      logger.error("Failed to get unread count", { error, userId });
      throw error;
    }
  }
}
