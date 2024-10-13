import { Elysia, t, Context } from "elysia";
import prisma from "../../middleware/prismaclient";
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

const JWT_SECRET = process.env.JWT_SECRET;
const PROJECT_ID = process.env.NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID;

if (!JWT_SECRET) throw new Error("JWT_SECRET is not set");
if (!PROJECT_ID)
  throw new Error("NEXT_PUBLIC_WALLET_CONNECT_PROJECT_ID is not set");

export class AuthError extends Error {
  constructor(public statusCode: number, message: string) {
    super(message);
    console.error(`AuthError: ${statusCode} - ${message}`);
  }
}

export interface AuthenticatedUser {
  walletAddress: string;
}

export interface AuthenticatedContext extends Context {
  user: AuthenticatedUser;
}

export const authRouter = new Elysia({ prefix: "/auth" })
  .use(rateLimit())
  .use(jwt({ name: "jwt", secret: JWT_SECRET }))
  .use(bearer())
  .post(
    "/login",
    async ({ body, set }) => {
      console.log(
        "Login attempt - Full request body:",
        JSON.stringify(body, null, 2)
      );
      const { message, signature } = body;

      try {
        console.log(
          `Login attempt received. Message length: ${message.length}, Signature length: ${signature.length}`
        );

        const address = getAddressFromMessage(message);
        const chainId = getChainIdFromMessage(message);

        console.log(`Extracted address: ${address}, chainId: ${chainId}`);
        console.log(
          `Verifying signature for address: ${address}, chainId: ${chainId}`
        );

        const isValid = await verifySignature({
          address,
          message,
          signature,
          chainId,
          projectId: PROJECT_ID,
        });

        if (!isValid) {
          console.warn(`Invalid signature for address: ${address}`);
          throw new AuthError(401, "Invalid signature");
        }

        console.log(`Signature verified successfully for address: ${address}`);
        console.log(`Finding or creating user for address: ${address}`);

        let user = await prisma.user.findUnique({
          where: { walletAddress: address },
        });
        if (!user) {
          console.log(`Creating new user for address: ${address}`);
          user = await prisma.user.create({
            data: {
              walletAddress: address,
              chainId: chainId.toString(),
              apiKey: generateApiKey(),
            },
          });
        } else if (user.chainId !== chainId.toString()) {
          console.log(
            `Updating chainId for existing user. Address: ${address}, New chainId: ${chainId}`
          );
          user = await prisma.user.update({
            where: { walletAddress: address },
            data: { chainId: chainId.toString() },
          });
        }

        const token = await prisma.user.createSession(user.walletAddress);

        console.log(`Session created for user: ${user.walletAddress}`);

        set.headers["Set-Cookie"] = `auth=${token}; HttpOnly; Path=/; Max-Age=${
          7 * 24 * 60 * 60
        }; SameSite=Strict`;

        return {
          user: {
            walletAddress: user.walletAddress,
            chainId: user.chainId,
          },
          accessToken: token,
        };
      } catch (error) {
        if (error instanceof AuthError) {
          console.error(`AuthError during login: ${error.message}`);
          throw error;
        }
        console.error(
          `Unexpected error during login: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
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
  .post("/logout", async ({ cookie: { auth }, set }) => {
    if (!auth.value) {
      throw new AuthError(401, "No session found");
    }
    await prisma.session.delete({ where: { token: auth.value } });
    auth.remove();
    set.headers[
      "Set-Cookie"
    ] = `auth=; HttpOnly; Path=/; Max-Age=0; SameSite=Strict`;
    return { message: "Logged out successfully" };
  })
  .onError(({ error, set }) => {
    console.error("Error in authRouter:", error);
    if (error instanceof AuthError) {
      set.status = error.statusCode;
      return { error: error.message };
    }
    set.status = 500;
    return { error: "Internal Server Error" };
  });

export const authMiddleware = new Elysia({ name: "authMiddleware" })
  .use(jwt({ name: "jwt", secret: JWT_SECRET }))
  .use(bearer())
  .derive(
    async ({
      request,
      jwt,
      bearer,
      set,
    }): Promise<{ user: AuthenticatedUser | null }> => {
      console.log("Auth middleware - Starting");

      const authHeader = request.headers.get("Authorization");
      console.log(`Auth middleware - Authorization header: ${authHeader}`);

      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.warn("Auth middleware - No valid Authorization header found");
        set.status = 401;
        set.headers[
          "WWW-Authenticate"
        ] = `Bearer realm='api', error="missing_token"`;
        return { user: null };
      }

      const token = authHeader.split(" ")[1];
      console.log(`Auth middleware - Token: ${token.substring(0, 10)}...`);

      try {
        const decodedToken = await jwt.verify(token);
        console.log(
          "Auth middleware - Decoded JWT payload:",
          JSON.stringify(decodedToken, null, 2)
        );

        if (
          !decodedToken ||
          typeof decodedToken !== "object" ||
          !decodedToken.sub
        ) {
          console.warn("Auth middleware - Invalid token payload");
          throw new AuthError(401, "Invalid token");
        }

        const user = await prisma.user.findUnique({
          where: { walletAddress: decodedToken.sub },
          select: {
            walletAddress: true,
            chainId: true,
          },
        });

        if (!user) {
          console.warn(
            `Auth middleware - User not found for walletAddress: ${decodedToken.sub}`
          );
          throw new AuthError(401, "User not found");
        }

        console.log(
          `Auth middleware - User authenticated: ${user.walletAddress}`
        );
        return { user };
      } catch (error) {
        console.error(
          `Auth Middleware - Error: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
        set.status = 401;
        set.headers[
          "WWW-Authenticate"
        ] = `Bearer realm='api', error="invalid_token"`;
        return { user: null };
      }
    }
  );

export const requireAuth = new Elysia()
  .use(authMiddleware)
  .derive(({ headers }) => {
    const userAddress = headers["x-user-address"];
    logger.debug("requireAuth - User address from header:", userAddress);

    if (!userAddress) {
      logger.warn("requireAuth - No X-User-Address header provided");
      throw new AuthError(401, "No user address provided");
    }

    return { user: { walletAddress: userAddress } };
  });

export default authRouter;

export function generateApiKey() {
  return crypto.randomBytes(32).toString("hex");
}
