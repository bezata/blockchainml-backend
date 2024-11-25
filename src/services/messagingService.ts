import { createCipheriv, createDecipheriv, randomBytes } from "crypto";
import { PrismaClient } from "@prisma/client";
import { logger } from "@/utils/monitor";
import { createPerformanceTracker } from "@/index";
import {
  MessageResponse,
  ConversationResponse,
  ConversationParticipantInfo,
} from "@/types/messaging/messagingservice";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET!;

export class MessagingService {
  private static readonly ALGORITHM = "aes-256-gcm";

  // Encryption helpers
  private static encrypt(text: string): { encrypted: string; iv: string } {
    const iv = randomBytes(16);
    const cipher = createCipheriv(
      this.ALGORITHM,
      Buffer.alloc(32, JWT_SECRET),
      iv
    );

    let encrypted = cipher.update(text, "utf8", "hex");
    encrypted += cipher.final("hex");
    const authTag = cipher.getAuthTag();

    return {
      encrypted: `${encrypted}:${authTag.toString("hex")}`,
      iv: iv.toString("hex"),
    };
  }

  private static decrypt(encrypted: string, iv: string): string {
    const perf = createPerformanceTracker("decrypt-message");

    try {
      const [content, authTag] = encrypted.split(":");
      const decipher = createDecipheriv(
        this.ALGORITHM,
        Buffer.alloc(32, JWT_SECRET),
        Buffer.from(iv, "hex")
      );

      decipher.setAuthTag(Buffer.from(authTag, "hex"));
      let decrypted = decipher.update(content, "hex", "utf8");
      decrypted += decipher.final("utf8");

      const duration = perf.end();
      logger.debug("Message decrypted", { duration });

      return decrypted;
    } catch (error) {
      const duration = perf.end();
      logger.error("Error decrypting message:", {
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
      throw new Error("Decryption failed");
    }
  }

  // Conversation methods
  static async createConversation(
    creatorAddress: string,
    participantAddresses: string[],
    isGroup: boolean = false,
    groupName?: string,
    groupAvatar?: string,
    metadata?: any
  ): Promise<ConversationResponse> {
    const perf = createPerformanceTracker("create-conversation");

    try {
      // Verify all participants exist
      const participants = await prisma.user.findMany({
        where: {
          walletAddress: {
            in: [...participantAddresses, creatorAddress],
          },
        },
        select: {
          walletAddress: true,
          username: true,
          name: true,
          avatar: true,
        },
      });

      if (participants.length !== participantAddresses.length + 1) {
        throw new Error("One or more participants not found");
      }

      // Create conversation with participants using transaction
      const conversation = await prisma.$transaction(async (prisma) => {
        // Create the conversation
        const conv = await prisma.conversation.create({
          data: {
            isGroup,
            groupName,
            groupAvatar,
            metadata,
            messageCount: 0,
          },
        });

        // Create participant records
        const participantData = participants.map((p) => ({
          conversationId: conv.id,
          walletAddress: p.walletAddress,
          isAdmin: p.walletAddress === creatorAddress,
        }));

        await prisma.conversationParticipant.createMany({
          data: participantData,
        });

        return conv;
      });

      // Fetch complete conversation data
      const completeConversation = await prisma.conversation.findUnique({
        where: { id: conversation.id },
        include: {
          participants: {
            include: {
              user: {
                select: {
                  walletAddress: true,
                  username: true,
                  name: true,
                  avatar: true,
                },
              },
            },
          },
        },
      });

      if (!completeConversation) {
        throw new Error("Failed to create conversation");
      }

      const duration = perf.end();
      logger.info("Conversation created", {
        conversationId: conversation.id,
        creatorAddress,
        participantCount: participants.length,
        duration,
      });

      return {
        ...completeConversation,
        participants: completeConversation.participants.map((p) => ({
          walletAddress: p.user.walletAddress,
          username: p.user.username,
          name: p.user.name || undefined,
          avatar: p.user.avatar || undefined,
          isAdmin: p.isAdmin,
          joinedAt: p.joinedAt,
          lastReadAt: p.lastReadAt || undefined,
          leftAt: p.leftAt || undefined,
        })),
        lastMessage: completeConversation.lastMessage || undefined,
        groupName: completeConversation.groupName || undefined,
        groupAvatar: completeConversation.groupAvatar || undefined,
        metadata: completeConversation.metadata || undefined,
      };
    } catch (error) {
      const duration = perf.end();
      logger.error("Error creating conversation:", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        creatorAddress,
        duration,
      });
      throw error;
    }
  }

  static async sendMessage(
    walletAddress: string,
    conversationId: string,
    content: string,
    type: string = "text",
    replyToId?: string,
    metadata?: any
  ): Promise<MessageResponse> {
    const perf = createPerformanceTracker("send-message");

    try {
      // Verify sender is participant
      const participant = await prisma.conversationParticipant.findUnique({
        where: {
          conversationId_walletAddress: {
            conversationId,
            walletAddress,
          },
        },
        include: {
          conversation: {
            include: {
              participants: {
                include: {
                  user: true,
                },
              },
            },
          },
        },
      });

      if (!participant || participant.leftAt) {
        throw new Error("Not a member of this conversation");
      }

      // Encrypt the message
      const { encrypted, iv } = this.encrypt(content);

      // Create message and update conversation in transaction
      const { message, sender } = await prisma.$transaction(async (prisma) => {
        // Create message
        const message = await prisma.message.create({
          data: {
            conversationId,
            walletAddress,
            content: `${encrypted}|${iv}`,
            type,
            replyTo: replyToId,
            metadata,
            readBy: [walletAddress],
          },
        });

        // Update conversation
        await prisma.conversation.update({
          where: { id: conversationId },
          data: {
            lastMessageAt: new Date(),
            lastMessage: content.substring(0, 50),
            messageCount: {
              increment: 1,
            },
          },
        });

        // Update sender's last read time
        await prisma.conversationParticipant.update({
          where: {
            conversationId_walletAddress: {
              conversationId,
              walletAddress,
            },
          },
          data: {
            lastReadAt: new Date(),
          },
        });

        return {
          message,
          sender: participant.conversation.participants.find(
            (p) => p.walletAddress === walletAddress
          )?.user,
        };
      });

      const duration = perf.end();
      logger.info("Message sent", {
        messageId: message.id,
        conversationId,
        walletAddress,
        type,
        duration,
      });

      return {
        ...message,
        senderName: sender?.name || "",
        senderUsername: sender?.username || "",
        senderAvatar: sender?.avatar || undefined,
        content: this.decrypt(
          message.content.split("|")[0],
          message.content.split("|")[1]
        ), // Return decrypted content for sender
        replyTo: message.replyTo || undefined,
        isEdited: message.isEdited,
        editedAt: message.editedAt || undefined,
        metadata: message.metadata || undefined,
        deletedAt: message.deletedAt || undefined,
      };
    } catch (error) {
      const duration = perf.end();
      logger.error("Error sending message:", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        walletAddress,
        conversationId,
        duration,
      });
      throw error;
    }
  }

  static async getMessages(
    userAddress: string,
    conversationId: string,
    limit = 50,
    offset = 0
  ): Promise<MessageResponse[]> {
    const perf = createPerformanceTracker("get-messages");

    try {
      // Verify user is participant
      const conversation = await prisma.conversation.findFirst({
        where: {
          id: conversationId,
          participants: {
            some: {
              walletAddress: userAddress,
            },
          },
        },
        include: {
          participants: {
            include: {
              user: true,
            },
          },
        },
      });

      if (!conversation) {
        throw new Error("Not a member of this conversation");
      }

      const messages = await prisma.message.findMany({
        where: {
          conversationId,
          deletedAt: null,
        },
        include: {
          sender: {
            select: {
              walletAddress: true,
              username: true,
              name: true,
              avatar: true,
            },
          },
        },
        orderBy: {
          createdAt: "desc",
        },
        skip: offset,
        take: limit,
      });

      const duration = perf.end();
      logger.info("Messages retrieved", {
        conversationId,
        userAddress,
        messageCount: messages.length,
        duration,
      });

      return messages.map(
        (message): MessageResponse => ({
          id: message.id,
          content: this.decrypt(
            message.content.split("|")[0],
            message.content.split("|")[1]
          ),
          walletAddress: message.walletAddress,
          senderName: message.sender.name ?? "",
          senderUsername: message.sender.username,
          senderAvatar: message.sender.avatar ?? undefined,
          type: message.type,
          readBy: message.readBy,
          replyTo: message.replyTo ?? undefined,
          isEdited: message.isEdited,
          editedAt: message.editedAt ?? undefined,
          metadata: message.metadata ?? undefined,
          conversationId: message.conversationId,
          createdAt: message.createdAt,
          deletedAt: message.deletedAt || undefined,
        })
      );
    } catch (error) {
      const duration = perf.end();
      logger.error("Error fetching messages:", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        userAddress,
        conversationId,
        duration,
      });
      throw error;
    }
  }

  static async getConversations(
    userAddress: string
  ): Promise<ConversationResponse[]> {
    const perf = createPerformanceTracker("get-conversations");

    try {
      const conversations = await prisma.conversation.findMany({
        where: {
          participants: {
            some: {
              walletAddress: userAddress,
              leftAt: null,
            },
          },
        },
        include: {
          participants: {
            where: {
              leftAt: null,
            },
            include: {
              user: {
                select: {
                  walletAddress: true,
                  username: true,
                  name: true,
                  avatar: true,
                },
              },
            },
          },
          messages: {
            orderBy: {
              createdAt: "desc",
            },
            take: 1,
          },
        },
        orderBy: {
          lastMessageAt: "desc",
        },
      });

      const duration = perf.end();
      logger.info("Conversations retrieved", {
        userAddress,
        conversationCount: conversations.length,
        duration,
      });

      return conversations.map(
        (conv): ConversationResponse => ({
          id: conv.id,
          participants: conv.participants.map(
            (p): ConversationParticipantInfo => ({
              walletAddress: p.user.walletAddress,
              username: p.user.username,
              name: p.user.name || undefined,
              avatar: p.user.avatar || undefined,
              isAdmin: p.isAdmin,
              joinedAt: p.joinedAt,
              lastReadAt: p.lastReadAt || undefined,
              leftAt: p.leftAt || undefined,
            })
          ),
          lastMessage: conv.lastMessage || undefined,
          lastMessageAt: conv.lastMessageAt,
          messageCount: conv.messageCount,
          isGroup: conv.isGroup,
          groupName: conv.groupName || undefined,
          groupAvatar: conv.groupAvatar || undefined,
          metadata: conv.metadata || undefined,
          createdAt: conv.createdAt,
          updatedAt: conv.updatedAt,
        })
      );
    } catch (error) {
      const duration = perf.end();
      logger.error("Error fetching conversations:", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        userAddress,
        duration,
      });
      throw error;
    }
  }

  static async markAsRead(
    walletAddress: string,
    conversationId: string
  ): Promise<{ success: boolean; count: number }> {
    const perf = createPerformanceTracker("mark-as-read");

    try {
      // Update in transaction
      const result = await prisma.$transaction(async (prisma) => {
        // Mark messages as read
        const messageResult = await prisma.message.updateMany({
          where: {
            conversationId,
            NOT: {
              readBy: {
                has: walletAddress,
              },
            },
          },
          data: {
            readBy: {
              push: walletAddress,
            },
          },
        });

        // Update participant's last read time
        await prisma.conversationParticipant.update({
          where: {
            conversationId_walletAddress: {
              conversationId,
              walletAddress,
            },
          },
          data: {
            lastReadAt: new Date(),
          },
        });

        return messageResult;
      });

      const duration = perf.end();
      logger.info("Messages marked as read", {
        walletAddress,
        conversationId,
        count: result.count,
        duration,
      });

      return { success: true, count: result.count };
    } catch (error) {
      const duration = perf.end();
      logger.error("Error marking messages as read:", {
        error:
          error instanceof Error
            ? {
                name: error.name,
                message: error.message,
                stack: error.stack,
              }
            : error,
        walletAddress,
        conversationId,
        duration,
      });
      throw error;
    }
  }
}
