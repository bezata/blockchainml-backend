import { Elysia, t } from "elysia";
import { PrismaClient, User } from "@prisma/client";
import crypto from "crypto";
import bcrypt from "bcrypt";
import { rateLimit } from "elysia-rate-limit";

const prisma = new PrismaClient();

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

class InvalidChainIdError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidChainIdError";
  }
}

async function authenticateUser(apiKey: string | undefined): Promise<User> {
  if (!apiKey) {
    throw new UnauthorizedError("API key is required");
  }

  const user = await prisma.user.findUnique({
    where: { apiKey },
  });

  if (!user) {
    throw new UnauthorizedError("Invalid API key");
  }

  return user;
}

function parseChainId(chainId: string | number): string {
  if (typeof chainId === "number") {
    return `eip155:${chainId}`;
  }

  if (typeof chainId === "string") {
    if (chainId.startsWith("eip155:")) {
      return chainId;
    } else {
      const parsed = parseInt(chainId);
      if (!isNaN(parsed)) {
        return `eip155:${parsed}`;
      }
    }
  }

  throw new InvalidChainIdError("Invalid chain ID format");
}

export const authRouter = new Elysia({ prefix: "/users" })
  .onError(({ code, error, set }) => {
    console.error("Error in authRouter:", error);
    if (error instanceof UnauthorizedError) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    if (error instanceof InvalidChainIdError) {
      set.status = 400;
      return { error: error.message };
    }
    set.status = typeof code === "number" ? code : 500;
    return { error: error instanceof Error ? error.message : String(error) };
  })
  .post(
    "/auth",
    async ({
      body,
      request,
    }: {
      body: { ethAddress: string; chainId: string | number };
      request: Request;
    }) => {
      const { ethAddress, chainId: rawChainId } = body;
      const chainId = parseChainId(rawChainId);
      const apiKey = request.headers.get("x-api-key");

      let user: User | null;

      if (apiKey) {
        user = await authenticateUser(apiKey);
      } else {
        user = await prisma.user.findUnique({
          where: { walletAddress: ethAddress },
        });

        if (!user) {
          const newApiKey = generateApiKey();
          user = await prisma.user.create({
            data: {
              walletAddress: ethAddress,
              chainId,
              apiKey: await bcrypt.hash(newApiKey, 10),
            },
          });
          return { ...user, apiKey: newApiKey };
        } else {
          user = await prisma.user.update({
            where: { id: user.id },
            data: { chainId },
          });
        }
      }

      const { apiKey: _, ...userWithoutApiKey } = user;
      return userWithoutApiKey;
    },
    {
      body: t.Object({
        ethAddress: t.String(),
        chainId: t.Union([t.String(), t.Number()]),
      }),
    }
  );

export const authMiddleware = new Elysia()
  .onError(({ error, set }) => {
    console.error("Error in authMiddleware:", error);
    if (error instanceof UnauthorizedError) {
      set.status = 401;
      return { error: error.message };
    }
    throw error;
  })
  .derive(async ({ request }: { request: Request }) => {
    const apiKey = request.headers.get("x-api-key") ?? undefined;
    const user = await authenticateUser(apiKey);
    return { user };
  });

function generateApiKey(): string {
  return crypto.randomBytes(32).toString("hex");
}
