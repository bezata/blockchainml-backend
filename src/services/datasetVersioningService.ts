import { PrismaClient, Dataset, File, Prisma } from "@prisma/client";
import { GitLFSDatasetService, gitLFSService, DatasetMetadata } from "./gitLFSservice";
import { S3DatasetService } from "./s3DatasetService";
import { logger } from "../utils/monitor";
import { 
  VersionTree, 
  VersionDiff, 
  VersionTag, 
  ValidationResult,
  DatasetMetrics,
  DatasetVersion,
  FileInfo,
  ValidationError 
  , GitLFSService,
} from "../types/dataset/dataset";
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import path from 'path';

const execAsync = promisify(exec);

class DatasetVersionError extends Error {
  constructor(
    public code: keyof typeof VERSION_ERRORS,
    message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'DatasetVersionError';
  }
}

interface GitOperationError extends Error {
  command?: string;
  stderr?: string;
  code?: number;
}


const VERSION_ERRORS = {
  INVALID_VERSION: 'INVALID_VERSION',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
  MERGE_CONFLICT: 'MERGE_CONFLICT',
  VALIDATION_FAILED: 'VALIDATION_FAILED',
} as const;




interface CreateDatasetInput {
  title: string;
  description?: string;
  tags: string[];
  isPrivate: boolean;
  files: Array<{ name: string; size: number; contentType: string }>;
}

interface CreateVersionInput {
  version: string;
  changes: string;
  files: Array<{ name: string; size: number; contentType: string }>;
}

export class DatasetVersioningService {
  private gitLFS: GitLFSService;
  private s3: S3DatasetService;
  private prisma: PrismaClient;

  constructor() {
    this.gitLFS = gitLFSService as GitLFSService;
    this.s3 = new S3DatasetService();
    this.prisma = new PrismaClient();
  }

  async getVersionTree(datasetId: string): Promise<VersionTree[]> {
    try {
      const { stdout } = await execAsync(`
        cd ${this.gitLFS.getRepoPath(datasetId, datasetId)} &&
        git log --format="%H" --all
      `);
      const commits = stdout.trim().split('\n');
      const tree: VersionTree[] = [];
      
      for (const commit of commits) {
        const metadata = await this.gitLFS.getVersionMetadata(datasetId, datasetId, commit);
        tree.push({
          version: commit,
          parent_version: metadata.parent_version || undefined,
          children: [],
          metadata: metadata.metadata || {},
          createdAt: new Date(metadata.created_at)
        });
      }
  
      // Build tree structure
      for (const node of tree) {
        if (node.parent_version) {
          const parent = tree.find(n => n.version === node.parent_version);
          if (parent) {
            parent.children.push(node);
          }
        }
      }
  
      return tree.filter(node => !node.parent_version);
    } catch (error) {
      logger.error('Error getting version tree:', error);
      throw new DatasetVersionError(
        'VERSION_NOT_FOUND',
        'Failed to get version tree',
        error
      );
    }
  }

  async getDiff(
    datasetId: string, 
    version1: string, 
    version2: string
  ): Promise<VersionDiff> {
    try {
      const v1Metadata = await this.gitLFS.getVersionMetadata(datasetId, datasetId, version1);
      const v2Metadata = await this.gitLFS.getVersionMetadata(datasetId, datasetId, version2);
      const files1 = await this.gitLFS.getFileList(datasetId, datasetId, version1);
      const files2 = await this.gitLFS.getFileList(datasetId, datasetId, version2);
  
      const added: FileInfo[] = [];
      const modified: FileInfo[] = [];
      const removed: FileInfo[] = [];
      const unchanged: FileInfo[] = [];

      // Process file changes
      for (const file of files1) {
        const matchingFile = files2.find(f => f.name === file.name);
        if (!matchingFile) {
          removed.push(file);
        } else if (matchingFile.size !== file.size || matchingFile.checksum !== file.checksum) {
          modified.push(matchingFile);
        } else {
          unchanged.push(file);
        }
      }

      // Find added files
      for (const file of files2) {
        if (!files1.find(f => f.name === file.name)) {
          added.push(file);
        }
      }

      const metadataChanges: Record<string, { old: any; new: any }> = {};
      Object.keys(v2Metadata.metadata || {}).forEach(key => {
        if (v1Metadata.metadata?.[key] !== v2Metadata.metadata?.[key]) {
          metadataChanges[key] = {
            old: v1Metadata.metadata?.[key],
            new: v2Metadata.metadata?.[key]
          };
        }
      });
  
      const sizeImpact = modified.reduce((sum, file) => {
        const oldFile = files1.find(f => f.name === file.name);
        return sum + (file.size - (oldFile?.size || 0));
      }, 0);
  
      return {
        added,
        removed,
        modified,
        unchanged,
        fileChanges: {
          added: added.map(f => f.name),
          modified: modified.map(f => ({
            name: f.name,
            sizeDiff: f.size - (files1.find(file => file.name === f.name)?.size || 0),
            contentChanges: 'Binary file differences' // Or implement actual diff for text files
          })),
          removed: removed.map(f => f.name)
        },
        metadataChanges,
        statistics: {
          totalChangedFiles: added.length + modified.length + removed.length,
          sizeImpact,
          changeTypes: {
            additions: added.length,
            modifications: modified.length,
            deletions: removed.length
          }
        }
      };
    } catch (error) {
      logger.error('Error getting version diff:', error);
      throw new DatasetVersionError(
        'VERSION_NOT_FOUND',
        'Failed to get version diff',
        error
      );
    }
  }
    

  async tagVersion(
    datasetId: string,
    version: string,
    tag: Omit<VersionTag, 'version' | 'createdAt'>
  ): Promise<VersionTag> {
    try {
      await execAsync(`
        cd ${this.gitLFS.getRepoPath(datasetId, datasetId)} &&
        git tag -a v${tag.name} ${version} -m "${tag.description || ''}"
      `);
      
      return {
        ...tag,
        version,
        createdAt: new Date()
      };
    } catch (error) {
      logger.error('Error tagging version:', error);
      throw new DatasetVersionError(
        'VERSION_NOT_FOUND',
        'Failed to tag version',
        error
      );
    }
  }

  private async getFileInfo(
    datasetId: string,
    filename: string,
    version: string
  ): Promise<FileInfo> {
    const { stdout } = await execAsync(`
      cd ${this.gitLFS.getRepoPath(datasetId, datasetId)} &&
      git show ${version}:${filename}
    `);

    return {
      name: filename,
      size: stdout.length,
      contentType: this.getContentType(filename),
      downloadUrl: await this.s3.getDownloadUrl(datasetId, filename),
      checksum: await this.getFileChecksum(datasetId, filename, version),
      storageKey: `${datasetId}/${filename}`
    };
  }

  private async getAllFiles(
    datasetId: string,
    version: string
  ): Promise<FileInfo[]> {
    const { stdout } = await execAsync(`
      cd ${this.gitLFS.getRepoPath(datasetId, datasetId)} &&
      git ls-tree -r --name-only ${version}
    `);

    const files = stdout.trim().split('\n').filter(Boolean);
    return Promise.all(
      files.map(filename => this.getFileInfo(datasetId, filename, version))
    );
  }

  private async getFileChecksum(
    datasetId: string,
    filename: string,
    version: string
  ): Promise<string> {
    const { stdout } = await execAsync(`
      cd ${this.gitLFS.getRepoPath(datasetId, datasetId)} &&
      git rev-parse ${version}:${filename}
    `);
    return stdout.trim();
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    const contentTypes: Record<string, string> = {
      'parquet': 'application/parquet',
      'arrow': 'application/arrow',
      'bin': 'application/octet-stream',
      'zip': 'application/zip',
      'gz': 'application/gzip',
      'json': 'application/json',
      'md': 'text/markdown'
    };
    return contentTypes[ext] || 'application/octet-stream';
  }

  async validateVersion(
    datasetId: string,
    version: string,
    options: {
      checksums?: boolean;
      metadata?: boolean;
      contentValidation?: boolean;
    } = {}
  ): Promise<ValidationResult> {
    try {
      const files = await this.gitLFS.getFileList(datasetId, datasetId, version);
      const metadata = await this.gitLFS.getVersionMetadata(datasetId, datasetId, version);
  
      const errors: ValidationResult['errors'] = [];
      const metrics: DatasetMetrics = {
        totalFiles: files.length,
        totalSize: files.reduce((sum: number, f: FileInfo) => sum + f.size, 0),
        averageFileSize: files.length > 0 ? files.reduce((sum: number, f: FileInfo) => sum + f.size, 0) / files.length : 0,
        lastUpdated: new Date(),
        accessCount: 0,
        validationStatus: 'pending',
        fileTypes: this.categorizeFileTypes(files)
      };
  
      if (options.checksums) {
        for (const file of files) {
          const isValid = await this.gitLFS.validateChecksum(datasetId, version, file.name);
          if (!isValid) {
            errors.push({
              code: 'INVALID_CHECKSUM',
              type: 'validation',
              message: `Invalid checksum for file: ${file.name}`,
              severity: 'error',
              timestamp: new Date()
            });
          }
        }
      }
  
      return {
        isValid: errors.length === 0,
        errors,
        metrics: this.convertMetricsToRecord(metrics)
      };
    } catch (error) {
      logger.error('Error validating version:', error);
      throw new DatasetVersionError(
        'VALIDATION_FAILED',
        'Failed to validate version',
        error
      );
    }
  }
  
  // Helper method to convert DatasetMetrics to Record<string, number>
  private convertMetricsToRecord(metrics: DatasetMetrics): Record<string, number> {
    return {
      totalFiles: metrics.totalFiles,
      totalSize: metrics.totalSize,
      averageFileSize: metrics.averageFileSize,
      accessCount: metrics.accessCount,
      ...metrics.fileTypes
    };
  }

  private async validateMetadata(metadata: Record<string, any>): Promise<ValidationResult> {
    const errors: ValidationError[] = [];
    const metrics: Record<string, number> = {};

    if (!metadata.description) {
      errors.push({
        code: 'MISSING_DESCRIPTION',
        message: 'Description is required',
        type: 'validation',
        severity: 'error',
        timestamp: new Date(),
        path: 'description'
      });
    }

    if (!metadata.version) {
      errors.push({
        code: 'MISSING_VERSION',
        message: 'Version is required',
        type: 'validation',
        severity: 'error',
        timestamp: new Date(),
        path: 'version'
      });
    }

    return {
      isValid: errors.length === 0,
      errors,
      metrics
    };
  }

  private categorizeFileTypes(files: FileInfo[]): Record<string, number> {
    const fileTypes: Record<string, number> = {};
    for (const file of files) {
      const ext = file.name.split('.').pop()?.toLowerCase() || 'unknown';
      fileTypes[ext] = (fileTypes[ext] || 0) + 1;
    }
    return fileTypes;
  }

  async createDataset(
    userWalletAddress: string,
    input: CreateDatasetInput
  ): Promise<{ dataset: Dataset; fileUrls: Array<{ fileName: string; uploadUrl: string; storageKey: string }> }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const dataset = await tx.dataset.create({
          data: {
            title: input.title,
            description: input.description,
            tags: input.tags,
            accessibility: input.isPrivate ? "private" : "public",
            userWalletAddress,
            downloads: 0,
            updatedAt: new Date()
          },
        });

        const metadata: DatasetMetadata = {
          name: input.title,
          description: input.description || "",
          version: "1.0.0",
          creator: userWalletAddress,
          license: "MIT",
          tags: input.tags,
          updatedAt: new Date().toISOString(),
        };

        await this.gitLFS.initializeDatasetRepo(
          userWalletAddress,
          dataset.id,
          metadata
        );

        const fileUrls = await Promise.all(
          input.files.map(async (file) => {
            const { uploadUrl, storageKey } = await this.s3.getUploadUrl(
              userWalletAddress,
              dataset.id,
              file.name,
              dataset.accessibility === "private"
            );

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
    input: CreateVersionInput
  ): Promise<{ fileUrls: Array<{ fileName: string; uploadUrl: string; storageKey: string }> }> {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const dataset = await tx.dataset.findFirst({
          where: {
            id: datasetId,
            userWalletAddress,
          },
        });

        if (!dataset) {
          throw new Error("Dataset not found or access denied");
        }

        await this.gitLFS.createVersion(
          userWalletAddress,
          datasetId,
          input.version,
          input.changes
        );

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
        throw new Error("Dataset not found or access denied"); }

        const versionMetadata = await this.gitLFS.getVersionMetadata(
          userWalletAddress,
          datasetId,
          version
        );
  
        const fileDetails = await Promise.all(
          dataset.files.map(async (file) => {
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
  
    async compareVersions(
      userWalletAddress: string,
      datasetId: string,
      version1: string,
      version2: string
    ): Promise<VersionDiff> {
      const v1Files = await this.gitLFS.getFileList(userWalletAddress, datasetId, version1);
      const v2Files = await this.gitLFS.getFileList(userWalletAddress, datasetId, version2);
      const v1Metadata = await this.gitLFS.getVersionMetadata(userWalletAddress, datasetId, version1);
      const v2Metadata = await this.gitLFS.getVersionMetadata(userWalletAddress, datasetId, version2);
      
      const added: FileInfo[] = [];
      const modified: FileInfo[] = [];
      const removed: FileInfo[] = [];
      const unchanged: FileInfo[] = [];

      // Process added and modified files
      for (const v2File of v2Files) {
        const v1File = v1Files.find(f => f.name === v2File.name);
        if (!v1File) {
          added.push(v2File);
        } else if (v1File.checksum !== v2File.checksum) {
          modified.push(v2File);
        } else {
          unchanged.push(v2File);
        }
      }

      // Process removed files
      for (const v1File of v1Files) {
        if (!v2Files.find(f => f.name === v1File.name)) {
          removed.push(v1File);
        }
      }

      return {
        added,
        modified,
        removed,
        unchanged,
        fileChanges: {
          added: added.map(f => f.name),
          modified: modified.map(f => ({
            name: f.name,
            sizeDiff: f.size - (v1Files.find(file => file.name === f.name)?.size || 0),
            contentChanges: 'Binary file differences'
          })),
          removed: removed.map(f => f.name)
        },
        metadataChanges: this.compareMetadata(v1Metadata.metadata, v2Metadata.metadata),
        statistics: {
          totalChangedFiles: added.length + modified.length + removed.length,
          sizeImpact: this.calculateSizeImpact(added, removed, modified),
          changeTypes: {
            additions: added.length,
            modifications: modified.length,
            deletions: removed.length
          }
        }
      };
    
    }
    async rollbackVersion(
      userWalletAddress: string,
      datasetId: string,
      targetVersion: string
    ): Promise<DatasetVersion> {
      return await this.withTransaction(async (prisma) => {
        const dataset = await prisma.dataset.findUnique({
          where: { id: datasetId, userWalletAddress }
        });
    
        if (!dataset) {
          throw new DatasetVersionError(VERSION_ERRORS.VERSION_NOT_FOUND, 'Dataset not found');
        }
    
        const versionFiles = await this.gitLFS.getFileList(userWalletAddress, datasetId, targetVersion);
        const metadata = await this.gitLFS.getVersionMetadata(userWalletAddress, datasetId, targetVersion);
        const changes = `Rollback to version ${targetVersion}`;
        
        await this.gitLFS.createVersion(userWalletAddress, datasetId, targetVersion, changes);
    
        return {
          version: targetVersion,
          parentVersion: metadata.parent_version,
          metadata: metadata.metadata || {},
          files: versionFiles,
          createdAt: new Date(),
          createdBy: userWalletAddress,
          commitHash: metadata.commit_hash,
          description: changes
        };
      });
    }

  
    async forkDataset(
      userWalletAddress: string,
      sourceDatasetId: string,
      targetVersion: string
    ): Promise<Dataset> {
      return await this.withTransaction(async (prisma) => {
        const sourceDataset = await prisma.dataset.findUnique({
          where: { id: sourceDatasetId }
        });
  
        if (!sourceDataset) {
          throw new DatasetVersionError(
            'VERSION_NOT_FOUND',
            'Source dataset not found'
          );
        }
  
        // Create forked dataset with metadata field
        const forkedDataset = await prisma.dataset.create({
          data: {
            title: `${sourceDataset.title}-fork`,
            description: `Fork of ${sourceDataset.title} at version ${targetVersion}`,
            userWalletAddress,
            tags: sourceDataset.tags,
            accessibility: sourceDataset.accessibility,
            downloads: 0,
            updatedAt: new Date(),
            metadata: JSON.stringify({
              forkedFrom: sourceDatasetId,
              forkedVersion: targetVersion
                    
            }) as any
          } as Prisma.DatasetCreateInput
        });
  
        // Initialize forked repository
        await this.gitLFS.forkRepository(
          userWalletAddress,
          sourceDatasetId,
          forkedDataset.id,
          targetVersion
        );
  
        return forkedDataset;
      });
    }
    private compareMetadata(
      oldMetadata?: Record<string, any>,
      newMetadata?: Record<string, any>
    ): Record<string, { old: any; new: any }> {
      const changes: Record<string, { old: any; new: any }> = {};
      const allKeys = new Set([
        ...Object.keys(oldMetadata || {}),
        ...Object.keys(newMetadata || {})
      ]);
    
      for (const key of allKeys) {
        if (oldMetadata?.[key] !== newMetadata?.[key]) {
          changes[key] = {
            old: oldMetadata?.[key],
            new: newMetadata?.[key]
          };
        }
      }
    
      return changes;
    }
    
    private calculateSizeImpact(
      added: FileInfo[],
      removed: FileInfo[],
      modified: FileInfo[]
    ): number {
      return (
        added.reduce((sum, file) => sum + file.size, 0) -
        removed.reduce((sum, file) => sum + file.size, 0) +
        modified.reduce((sum, file) => sum + file.size, 0)
      );
    }
    
    private async withTransaction<T>(
      operation: (prisma: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>) => Promise<T>
    ): Promise<T> {
      return await this.prisma.$transaction(operation);
    }
  
    async getDatasetFiles(
      userWalletAddress: string,
      datasetId: string,
      version?: string
    ) {
      try {
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
  
        const fileUrls = await Promise.all(
          dataset.files.map(async (file) => ({
            fileName: file.name,
            downloadUrl: await this.s3.getDownloadUrl(
              file.storageKey,
              dataset.accessibility === "private" ? userWalletAddress : undefined
            ),
          }))
        );
  
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
  
  export default DatasetVersioningService;