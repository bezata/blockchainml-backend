import { Elysia, t } from "elysia";
import { PrismaClient, Prisma } from "@prisma/client";
import { AppError } from "@/utils/errorHandler";
import { websocket } from "@elysiajs/websocket";

const prisma = new PrismaClient();

export const forumRouter = new Elysia({ prefix: "/forum" })
  .use(websocket())

  // WebSocket connection for real-time updates
  .ws("/live", {
    open(ws) {
      console.log("WebSocket connection opened");
    },
    message(ws, message) {
      console.log("Received message:", message);
    },
    close(ws) {
      console.log("WebSocket connection closed");
    },
  })

  // Get all posts
  .get("/posts", async () => {
    try {
      const posts = await prisma.post.findMany({
        include: { author: true, comments: { include: { author: true } } },
        orderBy: { createdAt: "desc" },
      });
      return posts;
    } catch (error) {
      throw new AppError("Failed to fetch posts", 500);
    }
  })

  // Create a new post
  .post(
    "/posts",
    async ({ body, set, jwt }) => {
      const { title, content, category } = body;
      const user = await jwt.verify();
      try {
        const newPost = await prisma.post.create({
          data: {
            title,
            content,
            category,
            authorId: user.id,
          },
          include: { author: true },
        });

        // Broadcast new post to all connected clients
        set.websocket?.send({ type: "new_post", data: newPost });

        return newPost;
      } catch (error) {
        throw new AppError("Failed to create post", 500);
      }
    },
    {
      body: t.Object({
        title: t.String(),
        content: t.String(),
        category: t.String(),
      }),
    }
  )

  // Get a specific post
  .get("/posts/:id", async ({ params }) => {
    try {
      const post = await prisma.post.findUnique({
        where: { id: params.id },
        include: { author: true, comments: { include: { author: true } } },
      });
      if (!post) throw new AppError("Post not found", 404);
      return post;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Failed to fetch post", 500);
    }
  })

  // Update a post
  .patch(
    "/posts/:id",
    async ({ params, body, user }) => {
      try {
        const post = await prisma.post.findUnique({ where: { id: params.id } });
        if (!post) throw new AppError("Post not found", 404);
        if (post.authorId !== user.id) throw new AppError("Unauthorized", 403);

        const updatedPost = await prisma.post.update({
          where: { id: params.id },
          data: body,
          include: { author: true },
        });
        return updatedPost;
      } catch (error) {
        if (error instanceof AppError) throw error;
        throw new AppError("Failed to update post", 500);
      }
    },
    {
      body: t.Object({
        title: t.Optional(t.String()),
        content: t.Optional(t.String()),
        category: t.Optional(t.String()),
      }),
    }
  )

  // Delete a post
  .delete("/posts/:id", async ({ params, user }) => {
    try {
      const post = await prisma.post.findUnique({ where: { id: params.id } });
      if (!post) throw new AppError("Post not found", 404);
      if (post.authorId !== user.id) throw new AppError("Unauthorized", 403);

      await prisma.post.delete({ where: { id: params.id } });
      return { message: "Post deleted successfully" };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Failed to delete post", 500);
    }
  })

  // Add a comment to a post
  .post(
    "/posts/:id/comments",
    async ({ params, body, user, set }) => {
      try {
        const newComment = await prisma.comment.create({
          data: {
            content: body.content,
            postId: params.id,
            authorId: user.id,
          },
          include: { author: true },
        });

        // Broadcast new comment to all connected clients
        set.websocket.send({ type: "new_comment", data: newComment });

        return newComment;
      } catch (error) {
        throw new AppError("Failed to add comment", 500);
      }
    },
    {
      body: t.Object({
        content: t.String(),
      }),
    }
  )

  // Delete a comment
  .delete("/comments/:id", async ({ params, user }) => {
    try {
      const comment = await prisma.comment.findUnique({
        where: { id: params.id },
      });
      if (!comment) throw new AppError("Comment not found", 404);
      if (comment.authorId !== user.id) throw new AppError("Unauthorized", 403);

      await prisma.comment.delete({ where: { id: params.id } });
      return { message: "Comment deleted successfully" };
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Failed to delete comment", 500);
    }
  })

  // Get user profile
  .get("/users/:id", async ({ params }) => {
    try {
      const user = await prisma.user.findUnique({
        where: { id: params.id },
        select: {
          id: true,
          name: true,
          email: true,
          bio: true,
          avatar: true,
          createdAt: true,
          posts: {
            select: {
              id: true,
              title: true,
              createdAt: true,
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          comments: {
            select: {
              id: true,
              content: true,
              createdAt: true,
              post: {
                select: {
                  id: true,
                  title: true,
                },
              },
            },
            orderBy: { createdAt: "desc" },
            take: 5,
          },
          privacy: true,
        },
      });

      if (!user) throw new AppError("User not found", 404);

      // Remove email if user has set it to private
      if (
        user.privacy &&
        typeof user.privacy === "object" &&
        "showEmail" in user.privacy &&
        !user.privacy.showEmail
      ) {
        const userWithoutEmail = { ...user };
        delete userWithoutEmail.email;
        return userWithoutEmail;
      }

      return user;
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError("Failed to fetch user profile", 500);
    }
  });

export default forumRouter;
