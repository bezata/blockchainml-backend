import { Elysia, t } from "elysia";
import { Prisma, PrismaClient } from "@prisma/client";
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

logger.info("Starting auth.ts initialization");

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;

logger.info("Environment variables loaded", {
  JWT_SECRET: !!JWT_SECRET,
  PROJECT_ID: !!PROJECT_ID,
});

if (!JWT_SECRET) throw new Error("JWT_SECRET is not set");
if (!PROJECT_ID)
  throw new Error("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is not set");

interface AuthenticatedUser {
  walletAddress: string;
  chainId: string;
}

const adjectives = [
  "Funny",
  "Silly",
  "Quirky",
  "Zany",
  "Wacky",
  "Goofy",
  "Hilarious",
  "Amusing",
  "Witty",
  "Clever",
  "Playful",
  "Jolly",
  "Merry",
  "Joyful",
  "Cheerful",
  "Whimsical",
];

const nouns = [
  "Panda",
  "Penguin",
  "Platypus",
  "Narwhal",
  "Unicorn",
  "Dragon",
  "Phoenix",
  "Yeti",
  "Sasquatch",
  "Mermaid",
  "Wizard",
  "Ninja",
  "Pirate",
  "Astronaut",
  "Dinosaur",
  "Robot",
];

function generateRandomUsername(): string {
  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 1000);
  return `${adjective}${noun}${number}`;
}

async function createUniqueUsername(): Promise<string> {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const username = generateRandomUsername();
    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (!existingUser) {
      return username;
    }
    attempts++;
  }

  logger.error("Failed to generate a unique username after multiple attempts");
  throw new Error(
    "Failed to generate a unique username after multiple attempts"
  );
}

async function createOrUpdateUser(
  address: string,
  chainId: string,
  username: string,
  email: string | null = null
): Promise<Prisma.UserGetPayload<{}>> {
  logger.info("Attempting to create/update user", {
    address,
    chainId,
    username,
    email,
  });

  try {
    const existingUser = await prisma.user.findUnique({
      where: { walletAddress: address },
    });

    if (existingUser) {
      logger.info("Updating existing user", { address });
      return await prisma.user.update({
        where: { walletAddress: address },
        data: {
          chainId: chainId.toString(),
          lastLoginAt: new Date(),
          email: email, // Update email if provided
        },
      });
    } else {
      logger.info("Creating new user", { address });

      // Check for existing user with the same email if email is provided
      if (email) {
        const existingUserWithEmail = await prisma.user.findFirst({
          where: { email: email },
        });
        if (existingUserWithEmail) {
          logger.warn("Email already in use", { email });
          throw new AuthError(409, "Email already in use");
        }
      }

      const newUserData: Prisma.UserCreateInput = {
        walletAddress: address,
        chainId: chainId.toString(),
        apiKey: crypto.randomBytes(32).toString("hex"),
        username: username,
        email: email,
        avatar: `https://i.ibb.co/MMsLCsp/angry.png`,
        defaultPaymentAddress: address,
        selectedPaymentAddress: address,
        twoFactorEnabled: false,
      };
      logger.debug("New user data", newUserData);

      return await prisma.user.create({
        data: newUserData,
      });
    }
  } catch (error) {
    logger.error("Error in createOrUpdateUser", { error });
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      logger.error("Prisma error", { code: error.code, meta: error.meta });
      if (error.code === "P2002") {
        const target = error.meta?.target as string[];
        logger.error("Unique constraint violation", { target });
        if (target && target.includes("username")) {
          const newUsername = await createUniqueUsername();
          return createOrUpdateUser(address, chainId, newUsername);
        } else if (target && target.includes("email")) {
          throw new AuthError(409, "Email already in use");
        }
      }
    }
    throw error;
  }
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
      logger.info("Login attempt", { body });
      const { message, signature } = body;

      try {
        const address = getAddressFromMessage(message);
        const chainId = getChainIdFromMessage(message);
        logger.info("Extracted data from message", { address, chainId });

        const isValid = await verifySignature({
          address,
          message,
          signature,
          chainId,
          projectId: PROJECT_ID,
        });
        logger.info("Signature verification result", { isValid });

        if (!isValid) {
          logger.warn("Invalid signature", { address });
          throw new AuthError(401, "Invalid signature");
        }

        let user = await prisma.user.findUnique({
          where: { walletAddress: address },
        });
        logger.info("User found in database", { exists: !!user });

        if (!user) {
          const username = await createUniqueUsername();
          user = await createOrUpdateUser(address, chainId, username);
          logger.info("New user created", { user });
        } else {
          user = await prisma.user.update({
            where: { walletAddress: address },
            data: {
              chainId: chainId.toString(),
              lastLoginAt: new Date(),
            },
          });
          logger.info("Existing user updated", { user });
        }

        const token = await jwt.sign({
          sub: user.walletAddress,
          chainId: user.chainId,
        });
        logger.info("JWT token generated");

        auth.set({
          value: token,
          httpOnly: true,
          maxAge: 7 * 86400,
          path: "/",
        });
        logger.info("Auth cookie set");

        await prisma.session.create({
          data: {
            user: { connect: { walletAddress: user.walletAddress } },
            token: token,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        logger.info("Session created in database");

        return {
          user: {
            walletAddress: user.walletAddress,
            chainId: user.chainId,
            username: user.username,
          },
          accessToken: token,
        };
      } catch (error) {
        logger.error("Error during login", { error });
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
      logger.warn("No session found for logout");
      throw new AuthError(401, "No session found");
    }

    const profile = await jwt.verify(auth.value);
    if (!profile) {
      logger.warn("Invalid token for logout");
      throw new AuthError(401, "Invalid token");
    }

    await prisma.session.deleteMany({ where: { token: auth.value } });
    auth.remove();
    logger.info("User logged out successfully");

    return { message: "Logged out successfully" };
  })
  .use(authPlugin)
  .get("/profile", async ({ authenticatedUser, set }) => {
    if (!authenticatedUser) {
      logger.warn("Unauthorized access to profile");
      set.status = 401;
      return "Unauthorized";
    }

    logger.info("Profile accessed", { user: authenticatedUser });
    return authenticatedUser;
  })
  .onError(({ error, set, request }) => {
    if (error instanceof AuthError) {
      if (error.statusCode === 400) {
        logger.warn("Bad Request", { body: request.body });
      }
      set.status = error.statusCode;
      return { error: error.message };
    }
    logger.error("Unhandled error in authRouter", { error });
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default authRouter;
