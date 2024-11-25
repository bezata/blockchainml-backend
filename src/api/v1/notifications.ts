import { Elysia, t } from "elysia";
import prisma from "@/middleware/prismaclient";
import { PrismaClient } from "@prisma/client";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import {
  UserNotificationService,
  NotificationType,
  SourceType,
} from "@/services/userNotificationService";
import {
  notificationService,
  NotificationSchema,
  UpdateNotificationSchema,
  QuerySchema,
} from "@/types/notifications/notificaitons";

export const userNotificationsRouter = new Elysia({ prefix: "/notifications" })
  .use(authPlugin)
  .get("/", async ({ authenticatedUser, query }) => {
    if (!authenticatedUser) throw new AuthError(401, "Unauthorized");

    return await notificationService.getNotifications(authenticatedUser.id, {
      unreadOnly: query.unreadOnly === "true",
      limit: query.limit ? parseInt(query.limit as string) : undefined,
      offset: query.offset ? parseInt(query.offset as string) : undefined,
      sourceType: query.sourceType
        ? (query.sourceType as SourceType)
        : undefined,
    });
  })

  .post("/", async ({ body, authenticatedUser }) => {
    if (!authenticatedUser) throw new AuthError(401, "Unauthorized");

    const data = body as typeof NotificationSchema._type;
    return await notificationService.createNotification(
      authenticatedUser.id,
      data.type,
      data.title,
      data.message,
      data.sourceType,
      data.sourceId,
      data.data
    );
  })

  .patch("/:id", async ({ params, body, authenticatedUser }) => {
    if (!authenticatedUser) throw new AuthError(401, "Unauthorized");

    const { isRead } = body as typeof UpdateNotificationSchema._type;
    await notificationService.markAsRead(params.id, authenticatedUser.id);

    return { success: true };
  })

  .delete("/:id", async ({ params, authenticatedUser }) => {
    if (!authenticatedUser) throw new AuthError(401, "Unauthorized");

    await prisma.userNotification.delete({
      where: {
        id: params.id,
        userId: authenticatedUser.id,
      },
    });

    return { success: true };
  })

  .get("/unread-count", async ({ authenticatedUser, query }) => {
    if (!authenticatedUser) throw new AuthError(401, "Unauthorized");

    const count = await notificationService.getUnreadCount(
      authenticatedUser.id,
      query.sourceType ? (query.sourceType as SourceType) : undefined
    );

    return { count };
  })

  .patch("/mark-all-read", async ({ authenticatedUser, query }) => {
    if (!authenticatedUser) throw new AuthError(401, "Unauthorized");

    await notificationService.markAllAsRead(
      authenticatedUser.id,
      query.sourceType ? (query.sourceType as SourceType) : undefined
    );

    return { success: true };
  });

export default userNotificationsRouter;
