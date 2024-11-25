export interface UserPrivacySettings {
  profileVisibility: "public" | "private";
  showEmail: boolean;
  showSocialLinks: boolean;
  showWalletAddresses: boolean;
}

export interface NotificationPreferences {
  email: boolean;
  push: boolean;
  discord: boolean;
  browser: boolean;
  marketingEmails: boolean;
}
