import { GitLFSDatasetService } from '@/services/gitLFSservice';
export interface VersionTree {
    version: string;
    parent_version?: string;
    children: VersionTree[];
    metadata: Record<string, any>;
    createdAt: Date;
  }
  export interface VersionDiff {
    added: FileInfo[];
    modified: FileInfo[];
    removed: FileInfo[];
    unchanged: FileInfo[];
    fileChanges?: {
      added: string[];
      modified: {
        name: string;
        sizeDiff: number;
        contentChanges?: string;
      }[];
      removed: string[];
    };
    metadataChanges?: Record<string, { old: any; new: any }>;
    statistics?: {
      totalChangedFiles: number;
      sizeImpact: number;
      changeTypes: Record<string, number>;
    };
  }

  export interface VersionTag {
    name: string;
    description: string;
    version: string;
    createdAt: Date;
    createdBy: string;
  }

  export interface ValidationResult {
    isValid: boolean;
    errors: Array<{
      code: string;
      type: string;
      message: string;
      severity: 'error' | 'warning';
      timestamp: Date;
    }>;
    metrics: Record<string, number>;
  }

  export interface DatasetVersion {
    version: string;
    parentVersion?: string;
    metadata: Record<string, any>;
    files: FileInfo[];
    createdAt: Date;
    createdBy?: string;
    commitHash?: string;
    description?: string;
  }

  export interface FileInfo {
    name: string;
    size: number;
    contentType: string;
    storageKey: string;
    downloadUrl?: string;
    url?: string;
    checksum?: string;
    metadata?: Record<string, any>;
  }

  export interface ValidationError {
    code: string;
    message: string;
    type: string;
    severity: 'error' | 'warning';
    timestamp: Date;
    path?: string;
    details?: Record<string, any>;
  }
  
  export interface DatasetMetrics {
    totalFiles: number;
    totalSize: number;
    averageFileSize: number;
    lastUpdated: Date;
    accessCount: number;
    validationStatus: string;
    fileTypes: Record<string, number>;
  }
  export interface GitLFSService extends GitLFSDatasetService {
    getRepoPath(userId: string, datasetName: string): string;
    getFileList(userId: string, datasetName: string, version: string): Promise<FileInfo[]>;
    validateChecksum(userId: string, version: string, fileName: string): Promise<boolean>;
    forkRepository(userId: string, sourceDatasetId: string, targetDatasetId: string, version: string): Promise<void>;
  }

  export const VERSION_ERRORS = {
    INVALID_VERSION: 'INVALID_VERSION',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    VERSION_NOT_FOUND: 'VERSION_NOT_FOUND',
    MERGE_CONFLICT: 'MERGE_CONFLICT',
    VALIDATION_FAILED: 'VALIDATION_FAILED',
  } as const;