import jwt from "@elysiajs/jwt";
import Elysia, { t } from "elysia";
import { PrismaClient } from "@prisma/client";
import { logger, maskSensitiveData, loggerPlugin } from "../utils/monitor";

const prisma = new PrismaClient();
const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is not set in environment variables");
}

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    this.name = "AuthError";
  }
}

type LoggerContext = {
  requestLogger: typeof logger;
  logResponse: () => void;
};

export const authPlugin = (app: Elysia) =>
  app
    .use(loggerPlugin)
    .use(
      jwt({
        name: "jwt",
        secret: JWT_SECRET,
        exp: "7d",
      })
    )
    .derive(async ({ jwt, cookie: { auth }, set, store }) => {
      const authLogger = (store as LoggerContext)?.requestLogger || logger;
      const perf = {
        start: process.hrtime(),
        end: () => {
          const diff = process.hrtime(perf.start);
          return (diff[0] * 1e9 + diff[1]) / 1e6;
        },
      };

      authLogger.info("Starting authentication process", {
        component: "authPlugin",
        hasCookie: !!auth,
      });

      const token = auth?.value;

      // Mask the token before logging
      authLogger.debug("Processing authentication token", {
        hasToken: !!token,
        tokenMasked: token ? `${token.substring(0, 10)}...` : null,
      });

      if (!token) {
        const duration = perf.end();
        authLogger.warn("Authentication failed: No token provided", {
          duration,
          statusCode: 401,
        });
        set.status = 401;
        throw new AuthError(401, "Authentication required");
      }

      try {
        authLogger.debug("Verifying JWT token");
        const jwtPayload = await jwt.verify(token);

        if (!jwtPayload) {
          const duration = perf.end();
          authLogger.warn("Authentication failed: Invalid JWT token", {
            duration,
            statusCode: 401,
          });
          set.status = 401;
          throw new AuthError(401, "Invalid token");
        }

        const walletAddress = jwtPayload.sub as string;

        authLogger.debug("Fetching user from database", {
          walletAddress: maskSensitiveData({ walletAddress }).walletAddress,
        });

        const user = await prisma.user.findUnique({
          where: { walletAddress },
        });

        if (!user) {
          const duration = perf.end();
          authLogger.warn("Authentication failed: User not found", {
            duration,
            statusCode: 401,
            walletAddress: maskSensitiveData({ walletAddress }).walletAddress,
          });
          set.status = 401;
          throw new AuthError(401, "User not found");
        }

        const duration = perf.end();
        authLogger.info("Authentication successful", {
          duration,
          walletAddress: maskSensitiveData({ walletAddress }).walletAddress,
          username: user.username,
        });

        return {
          authenticatedUser: {
            walletAddress: user.walletAddress,
            chainId: user.chainId,
            apiKey: maskSensitiveData({ apiKey: user.apiKey }).apiKey,
            username: user.username,
            avatar: user.avatar,
            bio: user.bio,
            email: user.email,
            language: user.language,
            theme: user.theme,
            twoFactorEnabled: user.twoFactorEnabled,
            defaultPaymentAddress: user.defaultPaymentAddress,
            selectedPaymentAddress: user.selectedPaymentAddress,
            createdAt: user.createdAt,
            updatedAt: user.updatedAt,
            lastLoginAt: user.lastLoginAt,
            name: user.name,
            id: user.id,
          },
        };
      } catch (error) {
        const duration = perf.end();
        authLogger.error("Authentication error", {
          duration,
          error:
            error instanceof Error
              ? {
                  name: error.name,
                  message: error.message,
                  stack: error.stack,
                }
              : error,
          statusCode: 401,
        });

        set.status = 401;
        throw new AuthError(401, "Authentication failed");
      }
    });

export default authPlugin;
