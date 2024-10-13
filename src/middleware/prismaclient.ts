import { PrismaClient } from "@prisma/client";
import { sign, verify } from "jsonwebtoken";

const prisma = new PrismaClient().$extends({
  model: {
    user: {
      async createSession(userId: string) {
        const token = sign({ userId }, process.env.JWT_SECRET!, {
          expiresIn: "7d",
        });
        const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days from now

        await prisma.session.create({
          data: {
            user: { connect: { walletAddress: userId } },
            token,
            expiresAt,
          },
        });

        return token;
      },

      async validateSession(token: string) {
        try {
          const decoded = verify(token, process.env.JWT_SECRET!) as {
            userId: string;
          };
          const session = await prisma.session.findUnique({
            where: { token },
            include: { user: true },
          });

          if (!session || session.expiresAt < new Date()) {
            return null;
          }

          return session.user;
        } catch (error) {
          return null;
        }
      },
    },
  },
});

export default prisma;
