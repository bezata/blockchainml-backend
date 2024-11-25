export const MESSAGING_CONSTANTS = {
  ENCRYPTION: {
    ALGORITHM: "aes-256-gcm",
    IV_LENGTH: 16,
    KEY_LENGTH: 32,
  },
  PAGINATION: {
    DEFAULT_LIMIT: 50,
    DEFAULT_OFFSET: 0,
  },
  MESSAGE_PREVIEW_LENGTH: 50,
} as const;

export enum MessageType {
  TEXT = "text",
  IMAGE = "image",
  FILE = "file",
  SYSTEM = "system",
}

export enum ConversationType {
  DIRECT = "direct",
  GROUP = "group",
}
