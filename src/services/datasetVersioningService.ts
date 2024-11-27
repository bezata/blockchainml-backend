import { PrismaClient, Dataset, File } from "@prisma/client";
import { GitLFSDatasetService, gitLFSService } from "./gitLFSservice";
import { S3DatasetService } from "./s3DatasetService";
import { logger } from "../utils/monitor";

interface DatasetFile {
  name: string;
  size: number;
  contentType: string;
}

export class DatasetVersioningService {
  private gitLFS: typeof gitLFSService;
  private s3: S3DatasetService;
  private prisma: PrismaClient;

  constructor() {
    this.gitLFS = gitLFSService;
    this.s3 = new S3DatasetService();
    this.prisma = new PrismaClient();
  }

  async createDataset(
    userWalletAddress: string,
    input: {
      title: string;
      description?: string;
      tags: string[];
      isPrivate: boolean;
      files: Array<{ name: string; size: number; contentType: string }>;
    }
  ) {
    try {
      // Start transaction
      return await this.prisma.$transaction(async (tx) => {
        // 1. Create dataset record
        const dataset = await tx.dataset.create({
          data: {
            title: input.title,
            description: input.description,
            tags: input.tags,
            accessibility: input.isPrivate ? "private" : "public",
            userWalletAddress,
          },
        });

        // 2. Initialize Git LFS repo for versioning and metadata
        const metadata = {
          name: input.title,
          description: input.description || "",
          version: "1.0.0",
          creator: userWalletAddress,
          license: "MIT", // Default or configurable
          tags: input.tags,
          updatedAt: new Date().toISOString(),
        };

        await this.gitLFS.initializeDatasetRepo(
          userWalletAddress,
          dataset.id,
          metadata
        );

        // 3. Get upload URLs for files
        const fileUrls = await Promise.all(
          input.files.map(async (file) => {
            const { uploadUrl, storageKey } = await this.s3.getUploadUrl(
              userWalletAddress,
              dataset.id,
              file.name,
              dataset.accessibility === "private"
            );

            // 4. Create file records
            await tx.file.create({
              data: {
                name: file.name,
                size: file.size,
                contentType: file.contentType,
                storageKey,
                datasetId: dataset.id,
              },
            });

            return { fileName: file.name, uploadUrl, storageKey };
          })
        );

        return { dataset, fileUrls };
      });
    } catch (error) {
      logger.error("Error creating dataset", { error, userWalletAddress });
      throw error;
    }
  }

  async createVersion(
    userWalletAddress: string,
    datasetId: string,
    input: {
      version: string;
      changes: string;
      files: Array<{ name: string; size: number; contentType: string }>;
    }
  ) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // 1. Verify dataset ownership
        const dataset = await tx.dataset.findFirst({
          where: {
            id: datasetId,
            userWalletAddress,
          },
        });

        if (!dataset) {
          throw new Error("Dataset not found or access denied");
        }

        // 2. Create new version in Git LFS
        await this.gitLFS.createVersion(
          userWalletAddress,
          datasetId,
          input.version,
          input.changes
        );

        // 3. Handle new files
        const fileUrls = await Promise.all(
          input.files.map(async (file) => {
            const { uploadUrl, storageKey } = await this.s3.getUploadUrl(
              userWalletAddress,
              datasetId,
              file.name,
              dataset.accessibility === "private"
            );

            await tx.file.create({
              data: {
                name: file.name,
                size: file.size,
                contentType: file.contentType,
                storageKey,
                datasetId,
              },
            });

            return { fileName: file.name, uploadUrl, storageKey };
          })
        );

        return { fileUrls };
      });
    } catch (error) {
      logger.error("Error creating dataset version", {
        error,
        userWalletAddress,
        datasetId,
      });
      throw error;
    }
  }
  async getVersionMetadata(
    userWalletAddress: string,
    datasetId: string,
    version: string
  ) {
    try {
      // First verify dataset access
      const dataset = await this.prisma.dataset.findFirst({
        where: {
          id: datasetId,
          OR: [{ userWalletAddress }, { accessibility: "public" }],
        },
        include: {
          files: true,
        },
      });

      if (!dataset) {
        throw new Error("Dataset not found or access denied");
      }

      // Get metadata from GitLFS
      const versionMetadata = await this.gitLFS.getVersionMetadata(
        userWalletAddress,
        datasetId,
        version
      );

      // Enhance metadata with S3 file information
      const fileDetails = await Promise.all(
        dataset.files.map(async (file) => {
          // Only include files that existed in this version
          if (
            versionMetadata.files?.added.includes(file.name) ||
            versionMetadata.files?.modified.includes(file.name)
          ) {
            return {
              name: file.name,
              size: file.size,
              contentType: file.contentType,
              downloadUrl: await this.s3.getDownloadUrl(
                file.storageKey,
                dataset.accessibility === "private"
                  ? userWalletAddress
                  : undefined
              ),
            };
          }
          return null;
        })
      );

      return {
        ...versionMetadata,
        dataset: {
          id: dataset.id,
          title: dataset.title,
          description: dataset.description,
          accessibility: dataset.accessibility,
          tags: dataset.tags,
        },
        files: fileDetails.filter(Boolean),
        creator: userWalletAddress,
        updatedAt: dataset.updatedAt,
      };
    } catch (error) {
      logger.error("Error getting version metadata", {
        error,
        userWalletAddress,
        datasetId,
        version,
      });
      throw error;
    }
  }

  // Add helper method for version comparison
  async compareVersions(
    userWalletAddress: string,
    datasetId: string,
    version1: string,
    version2: string
  ) {
    try {
      const [v1Metadata, v2Metadata] = await Promise.all([
        this.getVersionMetadata(userWalletAddress, datasetId, version1),
        this.getVersionMetadata(userWalletAddress, datasetId, version2),
      ]);

      // Compare file changes
      const changes = {
        added: v2Metadata.files?.filter(
          (f) => f && !v1Metadata.files?.find((f1) => f1 && f1.name === f.name)
        ),
        removed: v1Metadata.files?.filter(
          (f) => f && !v2Metadata.files?.find((f2) => f2 && f2.name === f.name)
        ),
        modified: v2Metadata.files?.filter((f) => {
          if (!f) return false;
          const oldFile = v1Metadata.files?.find(
            (f1) => f1 && f1.name === f.name
          );
          return oldFile && oldFile.size !== f.size;
        }),
      };

      // Compare metadata changes
      const metadataChanges: Record<string, { old: any; new: any }> = {};
      for (const [key, value] of Object.entries(v2Metadata.metadata || {})) {
        if (v1Metadata.metadata?.[key] !== value) {
          metadataChanges[key] = {
            old: v1Metadata.metadata?.[key],
            new: value,
          };
        }
      }

      return {
        version1: {
          version: version1,
          timestamp: v1Metadata.created_at,
        },
        version2: {
          version: version2,
          timestamp: v2Metadata.created_at,
        },
        changes,
        metadataChanges,
        stats: {
          filesAdded: changes.added?.length || 0,
          filesRemoved: changes.removed?.length || 0,
          filesModified: changes.modified?.length || 0,
          totalSizeDiff: this.calculateSizeDiff(
            v1Metadata.files,
            v2Metadata.files
          ),
        },
      };
    } catch (error) {
      logger.error("Error comparing versions", {
        error,
        userWalletAddress,
        datasetId,
        version1,
        version2,
      });
      throw error;
    }
  }

  private calculateSizeDiff(files1: any[], files2: any[]): number {
    const totalSize1 = files1?.reduce((sum, f) => sum + (f.size || 0), 0) || 0;
    const totalSize2 = files2?.reduce((sum, f) => sum + (f.size || 0), 0) || 0;
    return totalSize2 - totalSize1;
  }

  async getDatasetFiles(
    userWalletAddress: string,
    datasetId: string,
    version?: string
  ) {
    try {
      // 1. Get dataset and verify access
      const dataset = await this.prisma.dataset.findFirst({
        where: {
          id: datasetId,
          OR: [{ userWalletAddress }, { accessibility: "public" }],
        },
        include: {
          files: true,
        },
      });

      if (!dataset) {
        throw new Error("Dataset not found or access denied");
      }

      // 2. Get download URLs from S3
      const fileUrls = await Promise.all(
        dataset.files.map(async (file) => ({
          fileName: file.name,
          downloadUrl: await this.s3.getDownloadUrl(
            file.storageKey,
            dataset.accessibility === "private" ? userWalletAddress : undefined
          ),
        }))
      );

      // 3. Get version metadata from Git LFS if specified
      let versionMetadata = null;
      if (version) {
        versionMetadata = await this.gitLFS.getVersionMetadata(
          userWalletAddress,
          datasetId,
          version
        );
      }

      return {
        dataset,
        files: fileUrls,
        version: versionMetadata,
      };
    } catch (error) {
      logger.error("Error getting dataset files", {
        error,
        userWalletAddress,
        datasetId,
      });
      throw error;
    }
  }
}
