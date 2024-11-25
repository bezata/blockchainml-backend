import { logger } from "@/utils/monitor";

// Base interfaces
export interface BaseMessage {
  id: string;
  content: string;
  type: string;
  metadata?: any;
  createdAt: Date;
}

export interface BaseSender {
  walletAddress: string;
  username: string;
  name?: string;
  avatar?: string;
}

// Response interfaces
export interface MessageResponse extends BaseMessage {
  walletAddress: string;
  senderName: string;
  senderUsername: string;
  senderAvatar?: string;
  readBy: string[];
  replyTo?: string;
  isEdited: boolean;
  editedAt?: Date;
  conversationId: string;
  deletedAt?: Date;
}

export interface ConversationResponse {
  id: string;
  participants: ConversationParticipantInfo[];
  lastMessage?: string;
  lastMessageAt: Date;
  messageCount: number;
  isGroup: boolean;
  groupName?: string;
  groupAvatar?: string;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConversationParticipantInfo extends BaseSender {
  isAdmin: boolean;
  joinedAt: Date;
  lastReadAt?: Date;
  leftAt?: Date;
}

// Request types
export interface CreateConversationRequest {
  participantAddresses: string[];
  isGroup?: boolean;
  groupName?: string;
  groupAvatar?: string;
  metadata?: any;
}

export interface SendMessageRequest {
  content: string;
  type?: string;
  replyToId?: string;
  metadata?: any;
}

// Utility types
export type AuthenticatedRequest = {
  authenticatedUser: { walletAddress: string };
  store?: { requestLogger?: typeof logger };
};

export type MessageParams = {
  conversationId: string;
};

export type MessageQuery = {
  limit?: number;
  offset?: number;
};
