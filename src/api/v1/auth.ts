import { Elysia, t } from "elysia";
import { PrismaClient } from "@prisma/client";
import { rateLimit } from "elysia-rate-limit";
import {
  verifySignature,
  getAddressFromMessage,
  getChainIdFromMessage,
} from "@reown/appkit-siwe";
import { jwt } from "@elysiajs/jwt";
import { bearer } from "@elysiajs/bearer";
import crypto from "crypto";
import { logger } from "../../utils/monitor";
import { authPlugin, AuthError } from "../../middleware/authPlugin";

console.log("Starting auth.ts initialization");

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;

console.log("Environment variables loaded:", {
  JWT_SECRET: !!JWT_SECRET,
  PROJECT_ID: !!PROJECT_ID,
});

if (!JWT_SECRET) throw new Error("JWT_SECRET is not set");
if (!PROJECT_ID)
  throw new Error("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is not set");

export interface AuthenticatedUser {
  walletAddress: string;
  chainId: string;
  signature: string;
}

export const authRouter = new Elysia({ prefix: "/auth" })
  .use(rateLimit())
  .use(
    jwt({
      name: "jwt",
      secret: JWT_SECRET,
      exp: "7d",
    })
  )
  .use(bearer())
  .post(
    "/login",
    async ({ body, set, jwt, cookie: { auth } }) => {
      console.log("Login attempt - Full request body:", body);
      console.log("Current auth cookie:", auth);
      const { message, signature } = body;

      try {
        console.log("Extracting address and chainId from message");
        const address = getAddressFromMessage(message);
        const chainId = getChainIdFromMessage(message);
        console.log("Extracted data:", { address, chainId });

        console.log("Verifying signature");
        const isValid = await verifySignature({
          address,
          message,
          signature,
          chainId,
          projectId: PROJECT_ID,
        });
        console.log("Signature verification result:", isValid);

        if (!isValid) {
          console.warn(`Invalid signature for address: ${address}`);
          throw new AuthError(401, "Invalid signature");
        }

        console.log("Checking if user exists in database");
        let user = await prisma.user.findUnique({
          where: { walletAddress: address },
        });
        console.log("User found in database:", !!user);

        if (!user) {
          console.log(`Creating new user for address: ${address}`);
          user = await prisma.user.create({
            data: {
              walletAddress: address,
              chainId: chainId.toString(),
              apiKey: crypto.randomBytes(32).toString("hex"),
            },
          });
          console.log("New user created:", user);
        } else {
          console.log(`Updating existing user. Address: ${address}`);
          user = await prisma.user.update({
            where: { walletAddress: address },
            data: {
              chainId: chainId.toString(),
            },
          });
          console.log("User updated:", user);
        }

        console.log("Generating JWT token");
        const token = await jwt.sign({
          sub: user.walletAddress,
          chainId: user.chainId,
        });
        console.log("JWT token generated");

        console.log("Setting auth cookie");
        auth.set({
          value: token,
          httpOnly: true,
          maxAge: 7 * 86400,
          path: "/",
        });

        console.log("Creating session in database");
        await prisma.session.create({
          data: {
            userWalletAddress: user.walletAddress,
            token,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        console.log("Session created successfully");

        console.log("Login process completed successfully");
        return {
          user: {
            walletAddress: user.walletAddress,
            chainId: user.chainId,
          },
          accessToken: token,
        };
      } catch (error) {
        console.error("Error during login:", error);
        if (error instanceof AuthError) {
          throw error;
        }
        throw new AuthError(500, "Failed to process login");
      }
    },
    {
      body: t.Object({
        message: t.String(),
        signature: t.String(),
      }),
    }
  )
  .post("/logout", async ({ jwt, set, cookie: { auth } }) => {
    if (!auth.value) {
      throw new AuthError(401, "No session found");
    }

    const profile = await jwt.verify(auth.value);
    if (!profile) {
      throw new AuthError(401, "Invalid token");
    }

    await prisma.session.deleteMany({ where: { token: auth.value } });
    auth.remove();

    return { message: "Logged out successfully" };
  })
  .use(authPlugin)
  .get("/profile", async ({ authenticatedUser, set }) => {
    if (!authenticatedUser) {
      set.status = 401;
      return "Unauthorized";
    }

    return authenticatedUser;
  })
  .onError(({ error, set }) => {
    logger.error("Error in authRouter:", error);
    if (error instanceof AuthError) {
      set.status = error.statusCode;
      return { error: error.message };
    }
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default authRouter;
