import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { PrismaClient, User } from "@prisma/client";
import { logger } from "@/utils/monitor";
import { AuthError } from "@/api/v1/auth";
import { createPerformanceTracker } from "@/index";
import { MessagingService } from "@/services/messagingService";
import { ServerWebSocket } from "bun";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.NEXTAUTH_SECRET;
if (!JWT_SECRET) throw new Error("NEXTAUTH_SECRET is not set");

type MessageType =
  | "message_sent"
  | "message_delivered"
  | "message_read"
  | "user_typing"
  | "conversation_created"
  | "user_joined"
  | "user_left";

interface WebSocketData {
  user: User;
  activeConversations: Set<string>;
}

interface MessagingWebSocketMessage {
  type: MessageType;
  conversationId: string;
  data: any;
}

class MessagingWebSocketServer {
  private conversations = new Map<
    string,
    Set<ServerWebSocket<WebSocketData>>
  >();

  public async handleIncomingMessage(
    ws: ServerWebSocket<WebSocketData>,
    message: MessagingWebSocketMessage
  ) {
    const perf = createPerformanceTracker("ws-message-handling");

    try {
      switch (message.type) {
        case "message_sent":
          // Store message in database
          await MessagingService.sendMessage(
            ws.data.user.walletAddress,
            message.conversationId,
            message.data.content
          );
          // Broadcast to conversation participants
          this.publishToConversation(message.conversationId, {
            type: "message_sent",
            conversationId: message.conversationId,
            data: {
              ...message.data,
              senderId: ws.data.user.id,
              timestamp: new Date().toISOString(),
            },
          });
          break;

        case "message_delivered":
        case "message_read":
          await MessagingService.markAsRead(
            ws.data.user.walletAddress,
            message.conversationId
          );
          this.publishToConversation(message.conversationId, {
            type: message.type,
            conversationId: message.conversationId,
            data: {
              userId: ws.data.user.id,
              timestamp: new Date().toISOString(),
            },
          });
          break;

        case "user_typing":
          this.publishToConversation(
            message.conversationId,
            {
              type: "user_typing",
              conversationId: message.conversationId,
              data: {
                userId: ws.data.user.id,
                timestamp: new Date().toISOString(),
              },
            },
            ws
          ); // Exclude sender
          break;
      }

      const duration = perf.end();
      logger.info("WebSocket message handled", {
        type: message.type,
        conversationId: message.conversationId,
        userId: ws.data.user.id,
        duration,
      });
    } catch (error) {
      const duration = perf.end();
      logger.error("Error handling WebSocket message", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        type: message.type,
        conversationId: message.conversationId,
        userId: ws.data.user.id,
        duration,
      });
    }
  }

  public async joinConversation(
    ws: ServerWebSocket<WebSocketData>,
    conversationId: string
  ) {
    const perf = createPerformanceTracker("ws-join-conversation");

    try {
      // Verify user has access to conversation
      const hasAccess = await MessagingService.verifyConversationAccess(
        ws.data.user.walletAddress,
        conversationId
      );

      if (!hasAccess) {
        throw new AuthError(403, "No access to conversation");
      }

      // Add to conversation participants
      let participants = this.conversations.get(conversationId);
      if (!participants) {
        participants = new Set();
        this.conversations.set(conversationId, participants);
      }
      participants.add(ws);

      // Track active conversations for this connection
      ws.data.activeConversations.add(conversationId);

      // Notify other participants
      this.publishToConversation(
        conversationId,
        {
          type: "user_joined",
          conversationId,
          data: {
            userId: ws.data.user.id,
            timestamp: new Date().toISOString(),
          },
        },
        ws
      );

      const duration = perf.end();
      logger.info("User joined conversation", {
        userId: ws.data.user.id,
        conversationId,
        duration,
      });
    } catch (error) {
      const duration = perf.end();
      logger.error("Error joining conversation", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        userId: ws.data.user.id,
        conversationId,
        duration,
      });
      throw error;
    }
  }

  private publishToConversation(
    conversationId: string,
    message: MessagingWebSocketMessage,
    excludeWs?: ServerWebSocket<WebSocketData>
  ) {
    const participants = this.conversations.get(conversationId);
    if (!participants) return;

    participants.forEach((participant) => {
      if (participant === excludeWs) return;
      if (participant.readyState === WebSocket.OPEN) {
        participant.cork(() => {
          participant.send(JSON.stringify(message));
        });
      }
    });
  }

  public leaveConversation(
    ws: ServerWebSocket<WebSocketData>,
    conversationId: string
  ) {
    const participants = this.conversations.get(conversationId);
    if (participants) {
      participants.delete(ws);
      ws.data.activeConversations.delete(conversationId);

      // Notify other participants
      this.publishToConversation(conversationId, {
        type: "user_left",
        conversationId,
        data: {
          userId: ws.data.user.id,
          timestamp: new Date().toISOString(),
        },
      });

      // Clean up empty conversations
      if (participants.size === 0) {
        this.conversations.delete(conversationId);
      }
    }
  }
}

const messagingWsServer = new MessagingWebSocketServer();

export default new Elysia()
  .use(jwt({ name: "jwt", secret: JWT_SECRET }))
  .ws("/messages/ws", {
    body: t.Object({
      type: t.Union([
        t.Literal("message_sent"),
        t.Literal("message_delivered"),
        t.Literal("message_read"),
        t.Literal("user_typing"),
      ]),
      conversationId: t.String(),
      data: t.Object({
        content: t.Optional(t.String()),
        messageId: t.Optional(t.String()),
      }),
    }),

    // WebSocket configuration
    idleTimeout: 300, // 5 minutes idle timeout
    maxPayloadLength: 64 * 1024, // 64KB max message size
    backpressureLimit: 1024 * 1024, // 1MB backpressure limit
    closeOnBackpressureLimit: true,
    perMessageDeflate: true, // Enable compression

    // Authenticate connection
    beforeHandle: async ({ request, set }) => {
      const perf = createPerformanceTracker("ws-messaging-auth");

      try {
        const authHeader = request.headers.get("Authorization");
        if (!authHeader?.startsWith("Bearer ")) {
          throw new AuthError(401, "Invalid authorization header");
        }

        const token = authHeader.split(" ")[1];
        const jwtInstance = jwt({ name: "jwt", secret: JWT_SECRET });
        const payload = await jwtInstance.decorator.jwt.verify(token);

        if (!payload || typeof payload !== "object" || !("sub" in payload)) {
          throw new AuthError(401, "Invalid token");
        }

        const user = await prisma.user.findUnique({
          where: { id: payload.sub as string },
        });

        if (!user) {
          throw new AuthError(401, "User not found");
        }

        const duration = perf.end();
        logger.info("Messaging WebSocket authenticated", {
          userId: user.id,
          duration,
        });

        return {
          user,
          activeConversations: new Set<string>(),
        };
      } catch (error) {
        const duration = perf.end();
        logger.error("Messaging WebSocket auth failed", {
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
    },

    // Handle new connections
    open(ws: ServerWebSocket<WebSocketData>) {
      logger.info("Messaging WebSocket opened", {
        userId: ws.data.user.id,
      });
    },

    // Handle messages
    message(
      ws: ServerWebSocket<WebSocketData>,
      message: MessagingWebSocketMessage
    ) {
      if (!ws.data.activeConversations.has(message.conversationId)) {
        messagingWsServer
          .joinConversation(ws, message.conversationId)
          .then(() => messagingWsServer.handleIncomingMessage(ws, message))
          .catch((error) => {
            logger.error("Error handling message", {
              error:
                error instanceof Error
                  ? {
                      name: error.name,
                      message: error.message,
                      stack: error.stack,
                    }
                  : error,
              userId: ws.data.user.id,
              conversationId: message.conversationId,
            });
          });
      } else {
        messagingWsServer.handleIncomingMessage(ws, message);
      }
    },

    // Handle disconnections
    close(ws: ServerWebSocket<WebSocketData>) {
      ws.data.activeConversations.forEach((conversationId) => {
        messagingWsServer.leaveConversation(ws, conversationId);
      });

      logger.info("Messaging WebSocket closed", {
        userId: ws.data.user.id,
      });
    },
  });
