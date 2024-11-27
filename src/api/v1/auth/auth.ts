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
import { logger, maskSensitiveData, loggerPlugin } from "@/utils/monitor";
import authPlugin from "@/middleware/authPlugin";
import { adjectives, nouns } from "@/const/const";

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

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function generateRandomUsername(): string {
  const perf = {
    start: process.hrtime(),
    end: () => {
      const diff = process.hrtime(perf.start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };

  const adjective = adjectives[Math.floor(Math.random() * adjectives.length)];
  const noun = nouns[Math.floor(Math.random() * nouns.length)];
  const number = Math.floor(Math.random() * 1000);
  const username = `${adjective}${noun}${number}`;

  const duration = perf.end();
  logger.debug("Generated random username", {
    username,
    duration,
    components: {
      adjective,
      noun,
      number,
    },
  });

  return username;
}

async function createUniqueUsername(): Promise<string> {
  const perf = {
    start: process.hrtime(),
    end: () => {
      const diff = process.hrtime(perf.start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };

  let attempts = 0;
  const maxAttempts = 10;
  const attemptedUsernames: string[] = [];

  logger.info("Starting unique username generation", {
    maxAttempts,
  });

  while (attempts < maxAttempts) {
    const username = generateRandomUsername();
    attemptedUsernames.push(username);

    logger.debug("Checking username availability", {
      attempt: attempts + 1,
      username,
    });

    const existingUser = await prisma.user.findUnique({ where: { username } });

    if (!existingUser) {
      const duration = perf.end();
      logger.info("Successfully generated unique username", {
        username,
        attempts: attempts + 1,
        duration,
      });
      return username;
    }

    logger.debug("Username already exists, trying again", {
      username,
      attempt: attempts + 1,
    });

    attempts++;
  }

  const duration = perf.end();
  logger.error("Failed to generate unique username", {
    attempts,
    duration,
    attemptedUsernames,
  });

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
  const perf = {
    start: process.hrtime(),
    end: () => {
      const diff = process.hrtime(perf.start);
      return (diff[0] * 1e9 + diff[1]) / 1e6;
    },
  };

  logger.info("Starting user creation/update process", {
    userInfo: maskSensitiveData({
      address,
      chainId,
      username,
      email,
    }),
  });

  try {
    // Check for existing user
    logger.debug("Checking for existing user", {
      walletAddress: maskSensitiveData({ address }).address,
    });

    const existingUser = await prisma.user.findUnique({
      where: { walletAddress: address },
    });

    if (existingUser) {
      logger.info("Updating existing user", {
        walletAddress: maskSensitiveData({ address }).address,
        currentChainId: existingUser.chainId,
        newChainId: chainId,
      });

      const updatedUser = await prisma.user.update({
        where: { walletAddress: address },
        data: {
          chainId: chainId.toString(),
          lastLoginAt: new Date(),
          email: email,
        },
      });

      const duration = perf.end();
      logger.info("User updated successfully", {
        duration,
        walletAddress: maskSensitiveData({ address }).address,
        username: updatedUser.username,
      });

      return updatedUser;
    } else {
      logger.info("Creating new user", {
        walletAddress: maskSensitiveData({ address }).address,
      });

      // Check for email uniqueness
      if (email) {
        logger.debug("Checking email uniqueness", {
          email: maskSensitiveData({ email }).email,
        });

        const existingUserWithEmail = await prisma.user.findFirst({
          where: { email: email },
        });

        if (existingUserWithEmail) {
          const duration = perf.end();
          logger.warn("Email already in use", {
            duration,
            email: maskSensitiveData({ email }).email,
          });
          throw new AuthError(409, "Email already in use");
        }
      }

      const apiKey = crypto.randomBytes(32).toString("hex");
      const newUserData: Prisma.UserCreateInput = {
        walletAddress: address,
        chainId: chainId.toString(),
        apiKey,
        username,
        email,
        avatar: `https://i.ibb.co/MMsLCsp/angry.png`,
        defaultPaymentAddress: address,
        selectedPaymentAddress: address,
        twoFactorEnabled: false,
      };

      logger.debug("Preparing new user data", {
        userData: maskSensitiveData({
          ...newUserData,
          apiKey: "***",
          walletAddress: "***",
        }),
      });

      const newUser = await prisma.user.create({
        data: newUserData,
      });

      const duration = perf.end();
      logger.info("New user created successfully", {
        duration,
        walletAddress: maskSensitiveData({ address }).address,
        username: newUser.username,
      });

      return newUser;
    }
  } catch (error) {
    const duration = perf.end();
    logger.error("Error in user creation/update", {
      duration,
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
      context: maskSensitiveData({
        address,
        chainId,
        username,
        email,
      }),
    });

    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      logger.error("Prisma error details", {
        code: error.code,
        meta: error.meta,
      });

      if (error.code === "P2002") {
        const target = error.meta?.target as string[];
        logger.error("Unique constraint violation", { target });

        if (target?.includes("username")) {
          logger.info("Attempting to generate new unique username");
          const newUsername = await createUniqueUsername();
          return createOrUpdateUser(address, chainId, newUsername, email);
        } else if (target?.includes("email")) {
          throw new AuthError(409, "Email already in use");
        }
      }
    }
    throw error;
  }
}

export const authRouter = new Elysia({ prefix: "/auth" })
  .use(loggerPlugin)
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
    async ({ body, set, jwt, cookie: { auth }, store }) => {
      const routeLogger = (store as any)?.requestLogger || logger;
      const perf = {
        start: process.hrtime(),
        end: () => {
          const diff = process.hrtime(perf.start);
          return (diff[0] * 1e9 + diff[1]) / 1e6;
        },
      };

      routeLogger.info("Login attempt", {
        body: maskSensitiveData({
          message: body.message.substring(0, 20) + "...",
          signature: body.signature.substring(0, 10) + "...",
        }),
      });

      try {
        const address = getAddressFromMessage(body.message);
        const chainId = getChainIdFromMessage(body.message);
        routeLogger.info("Extracted data from message", {
          address: maskSensitiveData({ address }).address,
          chainId,
        });

        const isValid = await verifySignature({
          address,
          message: body.message,
          signature: body.signature,
          chainId,
          projectId: PROJECT_ID,
        });
        routeLogger.info("Signature verification result", { isValid });

        if (!isValid) {
          routeLogger.warn("Invalid signature", {
            address: maskSensitiveData({ address }).address,
          });
          throw new AuthError(401, "Invalid signature");
        }

        let user = await prisma.user.findUnique({
          where: { walletAddress: address },
        });
        routeLogger.info("User found in database", { exists: !!user });

        if (!user) {
          const username = await createUniqueUsername();
          user = await createOrUpdateUser(address, chainId, username);
          routeLogger.info("New user created", {
            user: maskSensitiveData({
              walletAddress: user.walletAddress,
              username: user.username,
            }),
          });
        } else {
          user = await prisma.user.update({
            where: { walletAddress: address },
            data: {
              chainId: chainId.toString(),
              lastLoginAt: new Date(),
            },
          });
          routeLogger.info("Existing user updated", {
            user: maskSensitiveData({
              walletAddress: user.walletAddress,
              username: user.username,
            }),
          });
        }

        const token = await jwt.sign({
          sub: user.walletAddress,
          chainId: user.chainId,
        });
        routeLogger.info("JWT token generated");

        auth.set({
          value: token,
          httpOnly: true,
          maxAge: 7 * 86400,
          path: "/",
        });
        routeLogger.info("Auth cookie set");

        await prisma.session.create({
          data: {
            user: { connect: { walletAddress: user.walletAddress } },
            token: token,
            expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          },
        });
        routeLogger.info("Session created in database");

        const duration = perf.end();
        routeLogger.info("Login successful", { duration });

        return {
          user: {
            walletAddress: user.walletAddress,
            chainId: user.chainId,
            username: user.username,
            apiKey: user.apiKey,
            email: user.email,
            avatar: user.avatar,
            defaultPaymentAddress: user.defaultPaymentAddress,
            selectedPaymentAddress: user.selectedPaymentAddress,
            twoFactorEnabled: user.twoFactorEnabled,
            bio: user.bio,
            language: user.language,
            theme: user.theme,
            githubProfileLink: user.githubProfileLink,
            xProfileLink: user.xProfileLink,
          },
          accessToken: token,
        };
      } catch (error) {
        const duration = perf.end();
        routeLogger.error("Error during login", {
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
  .post("/logout", async ({ jwt, set, cookie: { auth }, store }) => {
    const routeLogger = (store as any)?.requestLogger || logger;
    const perf = {
      start: process.hrtime(),
      end: () => {
        const diff = process.hrtime(perf.start);
        return (diff[0] * 1e9 + diff[1]) / 1e6;
      },
    };

    if (!auth.value) {
      routeLogger.warn("No session found for logout");
      throw new AuthError(401, "No session found");
    }

    try {
      const profile = await jwt.verify(auth.value);
      if (!profile) {
        routeLogger.warn("Invalid token for logout");
        throw new AuthError(401, "Invalid token");
      }

      await prisma.session.deleteMany({ where: { token: auth.value } });
      auth.remove();

      const duration = perf.end();
      routeLogger.info("User logged out successfully", { duration });

      return { message: "Logged out successfully" };
    } catch (error) {
      const duration = perf.end();
      routeLogger.error("Error during logout", {
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
      throw error;
    }
  })
  .use(authPlugin)
  .get("/profile", async ({ authenticatedUser, set, store }) => {
    const routeLogger = (store as any)?.requestLogger || logger;

    if (!authenticatedUser) {
      routeLogger.warn("Unauthorized access to profile");
      set.status = 401;
      return "Unauthorized";
    }

    routeLogger.info("Profile accessed", {
      user: maskSensitiveData({
        walletAddress: authenticatedUser.walletAddress,
        username: authenticatedUser.username,
      }),
    });
    return authenticatedUser;
  })
  .onError(({ error, set, request, store }) => {
    const errorLogger = (store as any)?.requestLogger || logger;

    if (error instanceof AuthError) {
      if (error.statusCode === 400) {
        errorLogger.warn("Bad Request", {
          body: maskSensitiveData(request.body),
        });
      }
      set.status = error.statusCode;
      return { error: error.message };
    }

    errorLogger.error("Unhandled error in authRouter", {
      error:
        error instanceof Error
          ? {
              name: error.name,
              message: error.message,
              stack: error.stack,
            }
          : error,
    });
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export default authRouter;
