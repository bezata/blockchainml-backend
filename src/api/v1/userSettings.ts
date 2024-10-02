import { Elysia, t } from "elysia";
import { PrismaClient } from "@prisma/client";
import crypto from "crypto";
import bcrypt from "bcrypt";

const prisma = new PrismaClient();

function generateApiKey(): string {
  return crypto.randomBytes(32).toString("hex");
}

export const userSettingsRouter = new Elysia({ prefix: "/user-settings" })
  .use((app) =>
    app.derive(async ({ request }) => {
      const authHeader = request.headers.get("Authorization");
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new Error("Unauthorized");
      }
      const userId = authHeader.split(" ")[1];
      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new Error("User not found");
      }
      return { user };
    })
  )
  .get("/", async ({ user }) => {
    console.log("Fetching user settings for user:", user.id);
    return user;
  })
  .patch(
    "/",
    async ({ user, body }) => {
      console.log("Updating user settings for user:", user.id);
      console.log("Update data:", body);
      try {
        const updatedUser = await prisma.user.update({
          where: { id: user.id },
          data: body,
        });
        console.log("User settings updated successfully");
        return updatedUser;
      } catch (error) {
        console.error("Error updating user settings:", error);
        throw new Error(`Failed to update user settings: ${error.message}`);
      }
    },
    {
      body: t.Object({
        name: t.Optional(t.String()),
        email: t.Optional(t.String()),
        bio: t.Optional(t.String()),
        avatar: t.Optional(t.String()),
        language: t.Optional(t.String()),
        theme: t.Optional(t.String()),
        notifications: t.Optional(
          t.Object({
            email: t.Boolean(),
            push: t.Boolean(),
            sms: t.Boolean(),
          })
        ),
        privacy: t.Optional(
          t.Object({
            profileVisibility: t.String(),
            showEmail: t.Boolean(),
          })
        ),
        twoFactor: t.Optional(t.Boolean()),
        defaultPaymentAddress: t.Optional(t.String()),
        paymentAddress: t.Optional(t.String()),
      }),
    }
  )
  .post("/renew-api-key", async ({ user }) => {
    console.log("Renewing API key for user:", user.id);
    try {
      const newApiKey = generateApiKey();
      const hashedApiKey = await bcrypt.hash(newApiKey, 10);

      await prisma.user.update({
        where: { id: user.id },
        data: { apiKey: hashedApiKey },
      });

      console.log("API key renewed successfully");
      return { apiKey: newApiKey };
    } catch (error) {
      console.error("Error renewing API key:", error);
      throw new Error(`Failed to renew API key: ${error.message}`);
    }
  });

export default userSettingsRouter;
