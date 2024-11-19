import { logger } from "@/utils/monitor";
import { PrismaClient } from "@prisma/client";

export type NotificationType =
  | "MEMBER_INVITED"
  | "ROLE_ASSIGNED"
  | "PROJECT_ASSIGNED"
  | "MENTION"
  | "ORGANIZATION_UPDATE"
  | "REVENUE_SHARE_UPDATE"
  | "BILLING_UPDATE";

export class OrganizationNotificationService {
  constructor(private prisma: PrismaClient) {}

  async createNotification(
    organizationId: string,
    recipientId: string,
    type: NotificationType,
    title: string,
    message: string,
    data?: Record<string, any>
  ) {
    try {
      // Check recipient's notification preferences
      const recipient = await this.prisma.organizationMember.findFirst({
        where: {
          organizationId,
          userId: recipientId,
        },
        include: {
          user: true,
        },
      });

      if (!recipient) {
        throw new Error("Recipient not found in organization");
      }

      // Check if the user wants to receive this type of notification
      const notificationPreferences =
        (recipient.user.notificationPreferences as Record<string, boolean>) ||
        {};
      if (notificationPreferences[type] === false) {
        logger.info("Notification skipped due to user preferences", {
          organizationId,
          recipientId,
          type,
        });
        return;
      }

      // Create the notification
      const notification = await this.prisma.organizationNotification.create({
        data: {
          organizationId,
          recipientId,
          type,
          title,
          message,
          data,
        },
      });

      // Handle real-time notifications (if WebSocket is connected)
      //@ts-expect-error: handled later
      if (global.wss && recipient.user.email) {
        this.sendWebSocketNotification(recipientId, {
          type,
          title,
          message,
          data,
          notificationId: notification.id,
        });
      }

      // Handle email notifications if enabled
      if (notificationPreferences.emailNotifications) {
        await this.sendEmailNotification(
          recipient.user.email || "",
          type,
          title,
          message,
          data
        );
      }

      logger.info("Organization notification created", {
        organizationId,
        recipientId,
        type,
        notificationId: notification.id,
      });

      return notification;
    } catch (error) {
      logger.error("Failed to create organization notification", {
        error,
        organizationId,
        recipientId,
        type,
      });
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
    // Implement email sending logic here
    // You can use a service like SendGrid, AWS SES, etc.
    logger.info("Email notification queued", { email, type, title });
  }

  private sendWebSocketNotification(
    recipientId: string,
    notification: Record<string, any>
  ) {
    // Implement WebSocket notification logic here
    logger.info("WebSocket notification sent", { recipientId, notification });
  }

  async getNotifications(
    userId: string,
    organizationId: string,
    options?: {
      unreadOnly?: boolean;
      limit?: number;
      offset?: number;
    }
  ) {
    const { unreadOnly = false, limit = 50, offset = 0 } = options || {};

    try {
      const notifications = await this.prisma.organizationNotification.findMany(
        {
          where: {
            organizationId,
            recipientId: userId,
            ...(unreadOnly ? { isRead: false } : {}),
          },
          orderBy: {
            createdAt: "desc",
          },
          take: limit,
          skip: offset,
        }
      );

      return notifications;
    } catch (error) {
      logger.error("Failed to fetch notifications", {
        error,
        userId,
        organizationId,
      });
      throw error;
    }
  }

  async markAsRead(notificationId: string, userId: string) {
    try {
      await this.prisma.organizationNotification.update({
        where: {
          id: notificationId,
          recipientId: userId,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
    } catch (error) {
      logger.error("Failed to mark notification as read", {
        error,
        notificationId,
        userId,
      });
      throw error;
    }
  }
}
