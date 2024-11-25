import { t } from "elysia";
import { validation } from "../../utils/security";

export type UserSettingsSchema = {
  username?: string;
  name?: string;
  email?: string;
  bio?: string;
  avatar?: string;
  language?: string;
  theme?: string;
  githubProfileLink?: string;
  xProfileLink?: string;
  discordProfileLink?: string;
  notificationPreferences?: {
    emailNotifications: boolean;
  };
  privacySettings?: {
    profileVisibility: "public" | "private" | "friends";
    showEmail?: boolean;
  };
  twoFactorEnabled?: boolean;
  defaultPaymentAddress?: string;
  selectedPaymentAddress?: string;
  paymentChainId?: string;
};
// Define the schema using Elysia's type system
export const userSettingsSchema = t.Object({
  username: t.Optional(t.String({ minLength: 3, maxLength: 30 })),
  name: t.Optional(t.String({ maxLength: 100 })),
  email: t.Optional(t.String({ validate: validation.isValidEmail })),
  bio: t.Optional(t.String({ maxLength: 500 })),
  avatar: t.Optional(t.String()),
  language: t.Optional(t.String()),
  theme: t.Optional(t.String()),
  githubProfileLink: t.Optional(t.String()),
  xProfileLink: t.Optional(t.String()),
  discordProfileLink: t.Optional(t.String()),
  notificationPreferences: t.Optional(
    t.Object({
      emailNotifications: t.Boolean(),
    })
  ),
  privacySettings: t.Optional(
    t.Object({
      profileVisibility: t.Union([
        t.Literal("public"),
        t.Literal("private"),
        t.Literal("friends"),
      ]),
      showEmail: t.Optional(t.Boolean()),
    })
  ),
  twoFactorEnabled: t.Optional(t.Boolean()),
  defaultPaymentAddress: t.Optional(t.String()),
  selectedPaymentAddress: t.Optional(t.String()),
  monetizationSettings: t.Optional(
    t.Object({
      paymentMethod: t.Optional(t.String()),
      paymentChainId: t.Optional(t.String()),
      subscriptionTier: t.Optional(t.String()),
      subscriptionStatus: t.Optional(
        t.Union([
          t.Literal("active"),
          t.Literal("inactive"),
          t.Literal("suspended"),
        ])
      ),
    })
  ),
});
