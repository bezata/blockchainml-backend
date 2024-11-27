import { Elysia, t } from "elysia";
import { UserService } from "../../services/userService";

export const usersRouter = new Elysia({ prefix: "/users" }).post(
  "/register",
  async ({ body }) => {
    const { email, name } = body;
    const { user, apiKey } = await UserService.createUser(email, name);
    return { user, apiKey };
  },
  {
    body: t.Object({
      email: t.String(),
      name: t.String(),
    }),
  }
);
