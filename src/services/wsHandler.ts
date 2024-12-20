import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { PrismaClient, User } from "@prisma/client";
import { logger } from "@/utils/monitor";
import { AuthError } from "@/api/v1/auth/auth";
import { createPerformanceTracker } from "@/index";
import { ServerWebSocket } from "bun";
import { WebSocketHandler } from "bun";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.NEXTAUTH_SECRET;
if (!JWT_SECRET) throw new Error("NEXTAUTH_SECRET is not set");

type MessageType =
  | "new_post"
  | "new_comment"
  | "post_liked"
  | "comment_liked"
  | "post_deleted"
  | "comment_deleted";

interface WebSocketData {
  user: User;
  topics: Set<string>;
}

interface WebSocketMessage {
  type: MessageType;
  data: any;
  topic?: string;
}

class WebSocketServer {
  private topics = new Map<string, Set<ServerWebSocket<WebSocketData>>>();

  public handleMessage(type: MessageType, data: any, topic?: string) {
    const perf = createPerformanceTracker(`ws-${type}`);

    try {
      const message: WebSocketMessage = { type, data, topic };
      if (topic) {
        this.publishToTopic(topic, message);
      } else {
        this.broadcastMessage(message);
      }

      const duration = perf.end();
      logger.info(`WebSocket message handled`, {
        type,
        topic,
        duration,
        dataSize: JSON.stringify(data).length,
      });
    } catch (error) {
      const duration = perf.end();
      logger.error(`Error handling WebSocket message`, {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        type,
        topic,
        duration,
      });
    }
  }

  private broadcastMessage(message: WebSocketMessage) {
    for (const [topic, clients] of this.topics) {
      this.publishToTopic(topic, message);
    }
  }

  private publishToTopic(topic: string, message: WebSocketMessage) {
    const clients = this.topics.get(topic);
    if (!clients) return;

    clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        // Batch multiple send operations for better performance
        client.cork(() => {
          client.send(JSON.stringify(message));
        });
      }
    });
  }
}

const wsServer = new WebSocketServer();

export default new Elysia()
  .use(jwt({ name: "jwt", secret: JWT_SECRET }))
  .ws("/ws", {
    type: "json" as const,
    data: {} as WebSocketData,
    body: t.Object({
      type: t.Union([
        t.Literal("new_post"),
        t.Literal("new_comment"),
        t.Literal("post_liked"),
        t.Literal("comment_liked"),
        t.Literal("post_deleted"),
        t.Literal("comment_deleted"),
      ]),
      data: t.Any(),
      topic: t.Optional(t.String()),
    }),

    // WebSocket configuration
    idleTimeout: 30, // 30 seconds idle timeout
    maxPayloadLength: 64 * 1024, // 64KB max message size
    backpressureLimit: 1024 * 1024, // 1MB backpressure limit
    closeOnBackpressureLimit: true,
    perMessageDeflate: true, // Enable compression

    // Authenticate connection
    beforeHandle: async (context: { data: WebSocketData } & any) => {
      const perf = createPerformanceTracker("ws-auth");

      try {
        const authHeader = context.request.headers.get("Authorization");
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

        context.data = { user, topics: new Set<string>() };
        return { user };
      } catch (error) {
        const duration = perf.end();
        logger.error("WebSocket authentication failed", {
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
    open(ws) {
      const perf = createPerformanceTracker("ws-open");
      const bunWs = ws.raw as ServerWebSocket<WebSocketData>;

      try {
        // Subscribe to user-specific topics
        const userTopic = `user:${bunWs.data.user.id}`;
        bunWs.subscribe(userTopic);
        bunWs.data.topics = new Set([userTopic]);

        const duration = perf.end();
        logger.info("WebSocket connection opened", {
          userId: bunWs.data.user.id,
          topics: Array.from(bunWs.data.topics),
          duration,
        });
      } catch (error) {
        const duration = perf.end();
        logger.error("Error in WebSocket open handler", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          userId: bunWs.data.user.id,
          duration,
        });
      }
    },

    // Handle messages
    message(ws, message) {
      const perf = createPerformanceTracker("ws-message");
      const bunWs = ws.raw as ServerWebSocket<WebSocketData>;

      try {
        if (message.topic) {
          ws.publish(message.topic, JSON.stringify(message));
        } else {
          wsServer.handleMessage(message.type, message.data, message.topic);
        }

        const duration = perf.end();
        logger.info("WebSocket message processed", {
          userId: bunWs.data.user.id,
          type: message.type,
          topic: message.topic,
          duration,
        });
      } catch (error) {
        const duration = perf.end();
        logger.error("Error processing WebSocket message", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          userId: bunWs.data.user.id,
          messageType: message.type,
          duration,
        });
      }
    },

    // Handle disconnections
    close(ws) {
      const perf = createPerformanceTracker("ws-close");
      const bunWs = ws.raw as ServerWebSocket<WebSocketData>;

      try {
        // Unsubscribe from all topics
        bunWs.data.topics.forEach((topic) => {
          bunWs.unsubscribe(topic);
        });

        const duration = perf.end();
        logger.info("WebSocket connection closed", {
          userId: bunWs.data.user.id,
          duration,
        });
      } catch (error) {
        const duration = perf.end();
        logger.error("Error in WebSocket close handler", {
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          userId: bunWs.data.user.id,
          duration,
        });
      }
    },
  });
