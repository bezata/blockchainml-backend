import { Elysia } from "elysia";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnauthorizedError";
  }
}

async function authenticateUser(apiKey: string | undefined) {
  console.log("Authenticating user with API key:", apiKey);
  if (!apiKey) {
    console.log("No API key provided");
    throw new UnauthorizedError("API key is required");
  }

  const user = await prisma.user.findUnique({
    where: { apiKey },
  });

  if (!user) {
    console.log("Invalid API key");
    throw new UnauthorizedError("Invalid API key");
  }

  console.log("User authenticated successfully");
  return user;
}

export const authMiddleware = new Elysia()
  .onError(({ code, error, set }) => {
    console.error("Error in authMiddleware:", error);
    if (error instanceof UnauthorizedError) {
      set.status = 401;
      return { error: error.message };
    }
    throw error; // Let the main app handle other types of errors
  })
  .derive(async ({ request }) => {
    console.log("Request in authMiddleware:", request.method, request.url);
    const apiKey = request.headers.get("x-api-key") ?? undefined;
    const user = await authenticateUser(apiKey);
    return { user };
  });
