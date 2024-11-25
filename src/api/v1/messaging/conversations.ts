import { Elysia, t } from "elysia";
import { MessagingService } from "@/services/messagingService";
import { authPlugin, AuthError } from "@/middleware/authPlugin";
import { logger } from "@/utils/monitor";
import {
  AuthenticatedRequest,
  MessageParams,
  MessageQuery,
} from "@/types/messaging/messagingservice";

export const messagingRouter = new Elysia({ prefix: "/messages" })
  .use(authPlugin)
  .post(
    "/conversations",
    async ({
      body,
      authenticatedUser,
      store,
    }: AuthenticatedRequest & { body: any }) => {
      const requestLogger = store?.requestLogger || logger;

      if (!authenticatedUser) {
        requestLogger.error("User conversations POST - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      try {
        return await MessagingService.createConversation(
          authenticatedUser.walletAddress,
          body.participants,
          body.isGroup,
          body.groupName
        );
      } catch (error) {
        requestLogger.error("Error creating conversation:", error);
        throw error;
      }
    },
    {
      body: t.Object({
        participants: t.Array(t.String()),
        isGroup: t.Optional(t.Boolean()),
        groupName: t.Optional(t.String()),
      }),
    }
  )

  .post(
    "/send",
    async ({
      body,
      authenticatedUser,
      store,
    }: AuthenticatedRequest & { body: any }) => {
      const requestLogger = store?.requestLogger || logger;

      if (!authenticatedUser) {
        requestLogger.error("Message send POST - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      try {
        return await MessagingService.sendMessage(
          authenticatedUser.walletAddress,
          body.conversationId,
          body.content
        );
      } catch (error) {
        requestLogger.error("Error sending message:", error);
        throw error;
      }
    },
    {
      body: t.Object({
        conversationId: t.String(),
        content: t.String(),
      }),
    }
  )

  .get(
    "/conversations/:conversationId/messages",
    async ({
      params,
      query,
      authenticatedUser,
      store,
    }: AuthenticatedRequest & {
      params: MessageParams;
      query: MessageQuery;
    }) => {
      const requestLogger = store?.requestLogger || logger;

      if (!authenticatedUser) {
        requestLogger.error("Messages GET - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      try {
        return await MessagingService.getMessages(
          authenticatedUser.walletAddress,
          params.conversationId,
          Number(query.limit),
          Number(query.offset)
        );
      } catch (error) {
        requestLogger.error("Error fetching messages:", error);
        throw error;
      }
    }
  )

  .get(
    "/conversations",
    async ({ authenticatedUser, store }: AuthenticatedRequest) => {
      const requestLogger = store?.requestLogger || logger;

      if (!authenticatedUser) {
        requestLogger.error("Conversations GET - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      try {
        return await MessagingService.getConversations(
          authenticatedUser.walletAddress
        );
      } catch (error) {
        requestLogger.error("Error fetching conversations:", error);
        throw error;
      }
    }
  )

  .post(
    "/conversations/:conversationId/read",
    async ({
      params,
      authenticatedUser,
      store,
    }: AuthenticatedRequest & {
      params: MessageParams;
    }) => {
      const requestLogger = store?.requestLogger || logger;

      if (!authenticatedUser) {
        requestLogger.error("Mark as read POST - No authenticated user");
        throw new AuthError(401, "Authentication required");
      }

      try {
        return await MessagingService.markAsRead(
          authenticatedUser.walletAddress,
          params.conversationId
        );
      } catch (error) {
        requestLogger.error("Error marking messages as read:", error);
        throw error;
      }
    }
  )

  .onError(({ error, set }) => {
    const errorLogger = logger;

    if (error instanceof AuthError) {
      errorLogger.warn("Auth error in messaging", {
        statusCode: error.statusCode,
        message: error.message,
      });
      set.status = error.statusCode;
      return { error: error.message };
    }

    errorLogger.error("Unexpected error in messaging router", {
      error:
        error instanceof Error
          ? { name: error.name, message: error.message, stack: error.stack }
          : error,
    });
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default messagingRouter;
