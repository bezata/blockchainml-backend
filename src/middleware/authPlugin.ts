import jwt from "@elysiajs/jwt";
import Elysia from "elysia";
import { PrismaClient } from "@prisma/client";
import { logger } from "../utils/monitor";

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

export const authPlugin = (app: Elysia) =>
  app
    .use(
      jwt({
        name: "jwt",
        secret: JWT_SECRET,
        exp: "7d",
      })
    )
    .derive(async ({ jwt, cookie: { auth }, set }) => {
      logger.info("AuthPlugin started");
      logger.info("Auth cookie:", auth);
      console.log(auth.cookie);
      const token = auth.value;
      logger.info("Access token from cookie:", token);

      if (!token) {
        logger.warn("No access token found in cookie");
        set.status = 401;
        throw new AuthError(401, "Authentication required");
      }

      try {
        logger.info("Verifying JWT token");
        const jwtPayload = await jwt.verify(token);
        logger.info("JWT verification result:", jwtPayload);

        if (!jwtPayload) {
          logger.warn("Invalid JWT token");
          set.status = 401;
          throw new AuthError(401, "Invalid token");
        }

        const walletAddress = jwtPayload.sub as string;
        logger.info("Fetching user from database");
        const user = await prisma.user.findUnique({
          where: { walletAddress },
        });
        logger.info("User found in database:", user);

        if (!user) {
          logger.warn("User not found in database");
          set.status = 401;
          throw new AuthError(401, "User not found");
        }

        logger.info("User successfully authenticated:", user.walletAddress);
        return {
          authenticatedUser: {
            walletAddress: user.walletAddress,
            chainId: user.chainId,
            apiKey: user.apiKey,
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
        logger.error("Error in authPlugin:", error);
        set.status = 401;
        throw new AuthError(401, "Authentication failed");
      }
    });

export default authPlugin;
