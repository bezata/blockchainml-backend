export interface OrganizationData {
  name: string;
  description?: string | null;
  badge?: string | null;
  websiteLink?: string | null;
  linkedinOrgLink?: string | null;
  discordServerLink?: string | null;
  twitterOrgLink?: string | null;
  githubOrgLink?: string | null;
  organizationLogo?: string | null;
  visibility?: "PUBLIC" | "PRIVATE";
  revenueSharing?: Record<string, any>;
}
