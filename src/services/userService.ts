import { PrismaClient } from "@prisma/client";
import crypto from "crypto";

const prisma = new PrismaClient();

export class UserService {
  static generateApiKey(): string {
    return crypto.randomBytes(32).toString("hex");
  }

  static async createUser(
    email: string,
    name: string
  ): Promise<{ user: any; apiKey: string }> {
    const apiKey = this.generateApiKey();
    const user = await prisma.user.create({
      data: {
        email,
        name,
        apiKey,
        walletAddress: walletAddress,
        chainId: chainId,
      },
    });
    return { user, apiKey };
  }

  static async getUserByApiKey(apiKey: string) {
    return await prisma.user.findUnique({
      where: { apiKey },
    });
  }
}
