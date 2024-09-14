import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

export class TrendingService {
  static async getTrendingDatasets(limit: number = 10) {
    const oneWeekAgo = new Date();
    oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);

    const datasets = await prisma.dataset.findMany({
      where: {
        updatedAt: { gte: oneWeekAgo },
      },
      select: {
        id: true,
        title: true,
        downloads: true,
        updatedAt: true,
      },
    });

    const trendingDatasets = datasets.map((dataset) => {
      const daysSinceUpdate =
        (new Date().getTime() - dataset.updatedAt.getTime()) /
        (1000 * 3600 * 24);
      const trendScore = dataset.downloads / Math.pow(daysSinceUpdate + 2, 1.8);
      return { ...dataset, trendScore };
    });

    trendingDatasets.sort((a, b) => b.trendScore - a.trendScore);

    return trendingDatasets.slice(0, limit);
  }

  static async incrementDownloads(datasetId: string) {
    await prisma.dataset.update({
      where: { id: datasetId },
      data: { downloads: { increment: 1 } },
    });
  }
}

export const trendingService = new TrendingService();
