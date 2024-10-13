import { Elysia, t } from "elysia";
import { logger } from "@/utils/monitor";
import { PrismaClient, Session, User } from "@prisma/client";
import { jwt } from "@elysiajs/jwt";
import { AuthError } from "@/api/v1/auth";

const prisma = new PrismaClient();

const JWT_SECRET = process.env.NEXTAUTH_SECRET;
if (!JWT_SECRET) throw new Error("NEXTAUTH_SECRET is not set");

type WebSocketMessage = {
  type:
    | "new_post"
    | "new_comment"
    | "post_liked"
    | "comment_liked"
    | "post_deleted"
    | "comment_deleted";
  data: any;
};

interface AuthenticatedWebSocket extends WebSocket {
  user: User;
}

class WSHandler {
  private clients: Set<AuthenticatedWebSocket> = new Set();

  public addClient(ws: AuthenticatedWebSocket) {
    this.clients.add(ws);
    logger.info(`New WebSocket client connected: ${ws.user.id}`);
  }

  public removeClient(ws: AuthenticatedWebSocket) {
    this.clients.delete(ws);
    logger.info(`WebSocket client disconnected: ${ws.user.id}`);
  }

  public broadcast(message: WebSocketMessage) {
    this.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(message));
      }
    });
  }

  public newPost(post: any) {
    this.broadcast({ type: "new_post", data: post });
  }

  public newComment(comment: any) {
    this.broadcast({ type: "new_comment", data: comment });
  }

  public postLiked(postId: string) {
    this.broadcast({ type: "post_liked", data: { id: postId } });
  }

  public commentLiked(commentId: string) {
    this.broadcast({ type: "comment_liked", data: { id: commentId } });
  }

  public postDeleted(postId: string) {
    this.broadcast({ type: "post_deleted", data: { id: postId } });
  }

  public commentDeleted(commentId: string) {
    this.broadcast({ type: "comment_deleted", data: { id: commentId } });
  }

  public async authenticateConnection(token: string): Promise<User | null> {
    try {
      const jwtInstance = jwt({ name: "jwt", secret: JWT_SECRET || "" });
      const payload = await jwtInstance.decorator.jwt.verify(token);
      if (!payload || typeof payload !== "object" || !("sub" in payload)) {
        return null;
      }

      const user = await prisma.user.findUnique({
        where: { id: payload.sub as string },
      });

      return user;
    } catch (error) {
      logger.error("Failed to authenticate WebSocket connection:", error);
      return null;
    }
  }
}

export const wsHandler = new WSHandler();

const app = new Elysia()
  .use(jwt({ name: "jwt", secret: JWT_SECRET }))
  .ws("/ws", {
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
    }),
    beforeHandle: async ({ request, set }) => {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        set.status = 401;
        throw new AuthError(401, "Invalid authorization header");
      }
      const token = authHeader.split(" ")[1];
      const user = await wsHandler.authenticateConnection(token);
      if (!user) {
        set.status = 401;
        throw new AuthError(401, "Unauthorized");
      }
      return { user };
    },
    open(ws: any) {
      wsHandler.addClient(ws as AuthenticatedWebSocket);
    },
    message(ws: any, message: WebSocketMessage) {
      logger.info(`Received WebSocket message from ${ws.user.id}:`, message);
      wsHandler.broadcast(message);
    },
    close(ws: any) {
      wsHandler.removeClient(ws as AuthenticatedWebSocket);
    },
  })
  .listen(4001);

logger.info(
  `WebSocket server is running on ${app.server?.hostname}:${app.server?.port}`
);
