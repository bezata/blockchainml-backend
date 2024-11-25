import prisma from "@/middleware/prismaclient";
import {
  UserNotificationService,
  NotificationType,
  SourceType,
} from "@/services/userNotificationService";
import { PrismaClient } from "@prisma/client";
import { t } from "elysia";

export const notificationService = new UserNotificationService(
  prisma as unknown as PrismaClient
);

export const NotificationSchema = t.Object({
  type: t.Enum(NotificationType),
  title: t.String(),
  message: t.String(),
  sourceType: t.Enum(SourceType),
  sourceId: t.Optional(t.String()),
  data: t.Optional(t.Object({})),
});

export const UpdateNotificationSchema = t.Object({
  isRead: t.Boolean(),
});

export const QuerySchema = t.Object({
  unreadOnly: t.Optional(t.Boolean()),
  limit: t.Optional(t.Number()),
  offset: t.Optional(t.Number()),
  sourceType: t.Optional(t.Enum(SourceType)),
});
