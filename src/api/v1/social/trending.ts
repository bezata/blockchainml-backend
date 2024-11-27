import { Elysia } from "elysia";
import { TrendingService } from "../../../services/trending";

export const trendingRouter = new Elysia({ prefix: "/api/v1/trending" }).get(
  "/datasets",
  async ({ query }) => {
    const limit = query.limit ? parseInt(query.limit as string) : 10;
    return await TrendingService.getTrendingDatasets(limit);
  }
);
