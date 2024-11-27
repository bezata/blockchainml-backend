# BlockchainML API Documentation

## Introduction

BlockchainML API provides access to blockchain-related datasets with versioning and advanced file management capabilities. Built with Elysia and integrated with S3 and Git LFS for robust dataset handling.

## Core Features

- 🗄️ **Dataset Management**: Create, version, and manage datasets
- 📦 **Large File Handling**: Support for files up to 5GB with chunked upload/download
- 🔄 **Version Control**: Git LFS integration for dataset versioning
- 🔐 **Access Control**: Private/public dataset management
- 📊 **Progress Tracking**: Upload/download progress monitoring
- 🚀 **Concurrent Operations**: Efficient batch file operations

## Authentication

Use Bearer token authentication:
```
Authorization: Bearer <token>
```

## API Endpoints

### Datasets

#### List Datasets
```
GET /api/v1/datasets
```
Query Parameters:
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 10)
- `sortBy`: Sort field ('title', 'createdAt', 'downloads')
- `sortOrder`: 'asc' or 'desc'
- `tag`: Filter by tag
- `search`: Search in title/description

#### Create Dataset
```
POST /api/v1/datasets
```
```json
{
  "title": "Dataset Name",
  "description": "Description",
  "tags": ["tag1", "tag2"],
  "isPrivate": false
}
```

#### Upload Files
```
POST /api/v1/datasets/upload-urls
```
```json
{
  "datasetName": "dataset-id",
  "files": [
    { "name": "file.csv", "size": 1024 }
  ]
}
```

#### Complete Upload
```
POST /api/v1/datasets/:id/complete
```
```json
{
  "files": [
    {
      "name": "file.csv",
      "storageKey": "key",
      "size": 1024,
      "contentType": "text/csv"
    }
  ]
}
```

#### Get Dataset
```
GET /api/v1/datasets/:id
```

#### Download Files
```
GET /api/v1/datasets/:id/download
```

### Version Control

#### Create Version
```
POST /api/v1/datasets/:id/versions
```
```json
{
  "version": "1.0.0",
  "changes": "Version notes",
  "files": [...]
}
```

#### Get Version
```
GET /api/v1/datasets/:id/versions/:version
```

## File Support

### Supported File Types
- Text: .csv, .json, .jsonl, .txt, .tsv
- Audio: .mp3, .wav, .flac, .m4a
- Image: .jpg, .jpeg, .png, .gif, .webp
- Archive: .zip, .gz, .tar, .7z
- Video: .mp4, .avi, .mov, .mkv
- Binary: .bin, .parquet, .arrow

### Size Limits
- Maximum file size: 5GB
- Maximum concurrent uploads: 5
- Chunk size: 5MB

## Error Handling

Standard HTTP status codes with detailed error messages:
```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Detailed error message",
    "details": {}
  }
}
```

## Rate Limiting

- 100 requests per minute per IP
- Headers:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`

## Security Features

- File validation and virus scanning
- Checksum verification
- Access control for private datasets
- Secure URL signing
- Input sanitization

## Example Usage

```typescript
// Upload dataset
const dataset = await client.datasets.create({
  title: "My Dataset",
  description: "Description",
  tags: ["blockchain", "ML"],
  isPrivate: false
});

// Upload files
const { uploadUrls } = await client.datasets.getUploadUrls(dataset.id, files);
await client.datasets.uploadFiles(uploadUrls);

// Create version
await client.datasets.createVersion(dataset.id, {
  version: "1.0.0",
  changes: "Initial release"
});
```

## Best Practices

1. Use chunked upload for large files
2. Implement proper error handling
3. Monitor upload/download progress
4. Validate files before upload
5. Use versioning for dataset changes

## Contributing

We welcome contributions! Please see our contributing guidelines for more details.

---
Made with ❤️ by the BlockchainML team
