import { exec } from "child_process";
import { promisify } from "util";
import { logger } from "../utils/monitor";
import fs from "fs/promises";
import path from "path";

interface VersionMetadata {
  version: string;
  changes: string;
  created_at: string;
  files?: {
    added: string[];
    modified: string[];
    removed: string[];
  };
  creator?: string;
  commit_hash?: string;
  parent_version?: string;
  stats?: {
    total_files: number;
    total_size: number;
  };
  metadata?: Record<string, any>;
}

const execAsync = promisify(exec);

export class GitLFSDatasetService {
  private baseDir: string;

  constructor() {
    this.baseDir = process.env.DATASETS_GIT_PATH || "/data/datasets";
  }

  async initializeDatasetRepo(
    userId: string,
    datasetName: string,
    metadata: DatasetMetadata
  ): Promise<string> {
    try {
      const repoPath = this.getRepoPath(userId, datasetName);

      // Create repository directory
      await fs.mkdir(repoPath, { recursive: true });

      // Initialize Git and Git LFS
      await execAsync(`
        cd ${repoPath} &&
        git init &&
        git lfs install &&
        git lfs track "*.parquet" "*.arrow" "*.bin" "*.zip" "*.gz" &&
        git lfs track "dataset_info.json" "README.md" "metadata/**/*"
      `);

      // Create initial dataset structure
      await this.createDatasetStructure(repoPath, metadata);

      // Initial commit
      await execAsync(`
        cd ${repoPath} &&
        git add . &&
        git commit -m "Initial dataset commit"
      `);

      logger.info("Initialized dataset repository", {
        userId,
        datasetName,
        repoPath,
      });

      return repoPath;
    } catch (error) {
      logger.error("Error initializing dataset repository", {
        error,
        userId,
        datasetName,
      });
      throw error;
    }
  }

  private async createDatasetStructure(
    repoPath: string,
    metadata: DatasetMetadata
  ) {
    // Create standard directory structure
    const dirs = ["data", "metadata", "scripts", "docs"];

    for (const dir of dirs) {
      await fs.mkdir(path.join(repoPath, dir), { recursive: true });
    }

    // Create dataset info file
    await fs.writeFile(
      path.join(repoPath, "dataset_info.json"),
      JSON.stringify(metadata, null, 2)
    );

    // Create README
    await fs.writeFile(
      path.join(repoPath, "README.md"),
      this.generateReadme(metadata)
    );

    // Create .gitattributes for LFS
    await fs.writeFile(
      path.join(repoPath, ".gitattributes"),
      this.generateGitAttributes()
    );

    // Create metadata files
    await this.createMetadataFiles(repoPath, metadata);
  }

  async updateDatasetFiles(
    userId: string,
    datasetName: string,
    files: Array<{
      storageKey: string;
      name: string;
      size: number;
      contentType: string;
    }>
  ) {
    const repoPath = this.getRepoPath(userId, datasetName);
    const metadataPath = path.join(repoPath, "metadata/files.json");

    try {
      // Update files metadata
      await fs.writeFile(
        metadataPath,
        JSON.stringify({ files, updated_at: new Date().toISOString() }, null, 2)
      );

      // Commit changes
      await execAsync(`
        cd ${repoPath} &&
        git add metadata/files.json &&
        git commit -m "Updated dataset files metadata"
      `);

      logger.info("Updated dataset files metadata", {
        userId,
        datasetName,
        fileCount: files.length,
      });
    } catch (error) {
      logger.error("Error updating dataset files", {
        error,
        userId,
        datasetName,
      });
      throw error;
    }
  }

  async createVersion(
    userId: string,
    datasetName: string,
    version: string,
    changes: string
  ) {
    if (!this.validateVersion(version)) {
      throw new Error(
        "Invalid version format. Must be semver compliant (e.g., 1.0.0)"
      );
    }

    const repoPath = this.getRepoPath(userId, datasetName);

    try {
      // Create version metadata
      const versionMetadata = {
        version,
        changes,
        created_at: new Date().toISOString(),
      };

      await fs.writeFile(
        path.join(repoPath, `metadata/versions/${version}.json`),
        JSON.stringify(versionMetadata, null, 2)
      );

      // Create version tag
      await execAsync(`
        cd ${repoPath} &&
        git add . &&
        git commit -m "Version ${version}" &&
        git tag -a v${version} -m "${changes}"
      `);

      logger.info("Created dataset version", {
        userId,
        datasetName,
        version,
      });
    } catch (error) {
      logger.error("Error creating dataset version", {
        error,
        userId,
        datasetName,
        version,
      });
      throw error;
    }
  }

  private getRepoPath(userId: string, datasetName: string): string {
    return path.join(this.baseDir, userId, datasetName);
  }

  private generateReadme(metadata: DatasetMetadata): string {
    return `# ${metadata.name}

${metadata.description}

## Dataset Information
- Creator: ${metadata.creator}
- Version: ${metadata.version}
- License: ${metadata.license}
- Last Updated: ${metadata.updatedAt}

## Tags
${metadata.tags.map((tag) => `- ${tag}`).join("\n")}

## File Structure
\`\`\`
datasets/
├── data/           # Dataset files
├── metadata/       # Metadata and versioning information
├── scripts/        # Loading and processing scripts
└── docs/           # Additional documentation
\`\`\`

## Usage
[Include usage instructions here]

## Citation
[Include citation information here]
`;
  }

  private generateGitAttributes(): string {
    return `# Data files
*.parquet filter=lfs diff=lfs merge=lfs -text
*.arrow filter=lfs diff=lfs merge=lfs -text
*.bin filter=lfs diff=lfs merge=lfs -text

# Archives
*.zip filter=lfs diff=lfs merge=lfs -text
*.gz filter=lfs diff=lfs merge=lfs -text
*.tar filter=lfs diff=lfs merge=lfs -text

# Metadata
dataset_info.json filter=lfs diff=lfs merge=lfs -text
metadata/**/* filter=lfs diff=lfs merge=lfs -text

# Documentation
*.pdf filter=lfs diff=lfs merge=lfs -text
`;
  }

  private async createMetadataFiles(
    repoPath: string,
    metadata: DatasetMetadata
  ) {
    const metadataDir = path.join(repoPath, "metadata");

    // Create metadata structure
    await Promise.all([
      fs.mkdir(path.join(metadataDir, "versions"), { recursive: true }),
      fs.mkdir(path.join(metadataDir, "stats"), { recursive: true }),
      fs.mkdir(path.join(metadataDir, "schema"), { recursive: true }),
    ]);

    // Create initial metadata files
    await Promise.all([
      fs.writeFile(
        path.join(metadataDir, "schema.json"),
        JSON.stringify(metadata.schema || {}, null, 2)
      ),
      fs.writeFile(
        path.join(metadataDir, "stats.json"),
        JSON.stringify(
          {
            created_at: new Date().toISOString(),
            file_count: 0,
            total_size: 0,
            downloads: 0,
          },
          null,
          2
        )
      ),
    ]);
  }

  async getVersionMetadata(
    userWalletAddress: string,
    datasetId: string,
    version: string
  ): Promise<VersionMetadata> {
    try {
      const repoPath = this.getRepoPath(userWalletAddress, datasetId);
      const versionPath = path.join(
        repoPath,
        "metadata",
        "versions",
        `${version}.json`
      );

      // Check if version metadata exists
      try {
        await fs.access(versionPath);
      } catch {
        throw new Error(`Version ${version} not found`);
      }

      // Read version metadata
      const metadata = JSON.parse(
        await fs.readFile(versionPath, "utf-8")
      ) as VersionMetadata;

      // Get commit information
      const { stdout: commitInfo } = await execAsync(`
        cd ${repoPath} &&
        git show-ref -s refs/tags/v${version}
      `);

      const commitHash = commitInfo.trim();

      // Get file changes for this version
      const { stdout: diffOutput } = await execAsync(`
        cd ${repoPath} &&
        git diff-tree --no-commit-id --name-status -r ${commitHash}
      `);

      // Parse diff output
      const changes = diffOutput
        .split("\n")
        .filter(Boolean)
        .reduce(
          (
            acc: {
              files: { added: string[]; modified: string[]; removed: string[] };
            },
            line
          ) => {
            const [status, file] = line.split("\t");
            if (status === "A") acc.files.added.push(file);
            else if (status === "M") acc.files.modified.push(file);
            else if (status === "D") acc.files.removed.push(file);
            return acc;
          },
          { files: { added: [], modified: [], removed: [] } }
        );

      const stats = await this.getVersionStats(repoPath, commitHash);

      return {
        ...metadata,
        commit_hash: commitHash,
        files: changes.files,
        stats,
        // Get parent version if it exists
        parent_version: await this.getParentVersion(repoPath, version),
      };
    } catch (error) {
      logger.error("Error retrieving version metadata", {
        error,
        userWalletAddress,
        datasetId,
        version,
      });
      throw error;
    }
  }
  private async getVersionStats(
    repoPath: string,
    commitHash: string
  ): Promise<{ total_files: number; total_size: number }> {
    try {
      const { stdout: lsOutput } = await execAsync(`
        cd ${repoPath} &&
        git ls-tree -r ${commitHash} --long
      `);

      const files = lsOutput.split("\n").filter(Boolean);
      const totalSize = files.reduce((sum, file) => {
        const size = parseInt(file.split(/\s+/)[3], 10);
        return sum + (isNaN(size) ? 0 : size);
      }, 0);

      return {
        total_files: files.length,
        total_size: totalSize,
      };
    } catch (error) {
      logger.error("Error getting version stats", {
        error,
        repoPath,
        commitHash,
      });
      return { total_files: 0, total_size: 0 };
    }
  }

  private async getParentVersion(
    repoPath: string,
    version: string
  ): Promise<string | undefined> {
    try {
      const { stdout } = await execAsync(`
        cd ${repoPath} &&
        git describe --abbrev=0 --tags v${version}^ 2>/dev/null || true
      `);

      const parentTag = stdout.trim();
      return parentTag ? parentTag.replace("v", "") : undefined;
    } catch {
      return undefined;
    }
  }

  // Add this helper method to validate version format
  private validateVersion(version: string): boolean {
    const semverRegex =
      /^\d+\.\d+\.\d+(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+)?$/;
    return semverRegex.test(version);
  }
}

export interface DatasetMetadata {
  name: string;
  description: string;
  version: string;
  creator: string;
  license: string;
  tags: string[];
  schema?: any;
  updatedAt: string;
}

export const gitLFSService = new GitLFSDatasetService();
