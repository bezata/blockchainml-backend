import { Elysia, t } from "elysia";
import { PrismaClient } from "@prisma/client";
import prisma from "@/middleware/prismaclient";
import { authPlugin, AuthError } from "../../middleware/authPlugin";
import {
  UserNotificationService,
  NotificationType,
  SourceType,
} from "@/services/userNotificationService";

const notificationService = new UserNotificationService(
  prisma as unknown as PrismaClient
);

const NotificationSchema = t.Object({
  type: t.Enum(NotificationType),
  title: t.String(),
  message: t.String(),
  sourceType: t.Enum(SourceType),
  sourceId: t.Optional(t.String()),
  data: t.Optional(t.Object({})),
});

const UpdateNotificationSchema = t.Object({
  isRead: t.Boolean(),
});

const QuerySchema = t.Object({
  unreadOnly: t.Optional(t.Boolean()),
  limit: t.Optional(t.Number()),
  offset: t.Optional(t.Number()),
  sourceType: t.Optional(t.Enum(SourceType)),
});

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
