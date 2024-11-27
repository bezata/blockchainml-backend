# BlockchainML API Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Core Features](#core-features)
3. [Authentication](#authentication)
4. [API Endpoints](#api-endpoints)
   - [Datasets](#datasets)
   - [Version Control](#version-control)
5. [File Support](#file-support)
6. [Error Handling](#error-handling)
7. [Rate Limiting](#rate-limiting)
8. [Security Features](#security-features)
9. [Example Usage](#example-usage)
10. [Best Practices](#best-practices)
11. [Contributing](#contributing)

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

All API requests must be authenticated using an API key. Include the API key in the `Authorization` header of your requests:

```
Authorization: Bearer YOUR_API_KEY
```

To obtain an API key, register for an account on the BlockchainML platform.

## API Endpoints

### Datasets

#### List Datasets

```
GET /api/v1/datasets
```

Query Parameters:

- `page` (optional): Page number for pagination (default: 1)
- `limit` (optional): Number of items per page (default: 10)
- `sortBy` (optional): Field to sort by ('title', 'createdAt', 'downloads')
- `sortOrder` (optional): Sort order ('asc' or 'desc')
- `tag` (optional): Filter by tag
- `search` (optional): Search term for title or description

Response:

```json
{
  "datasets": [
    {
      "id": "dataset_id",
      "title": "Dataset Title",
      "description": "Dataset Description",
      "tags": ["tag1", "tag2"],
      "downloads": 100,
      "createdAt": "2023-01-01T00:00:00Z"
    }
  ],
  "meta": {
    "total": 50,
    "page": 1,
    "limit": 10,
    "totalPages": 5
  }
}
```

#### Get Dataset

```
GET /api/v1/datasets/:id
```

Response:

```json
{
  "id": "dataset_id",
  "title": "Dataset Title",
  "description": "Dataset Description",
  "tags": ["tag1", "tag2"],
  "downloads": 100,
  "createdAt": "2023-01-01T00:00:00Z",
  "fileUrl": "https://storage.blockchainml.com/datasets/dataset_id.csv"
}
```

#### Create Dataset

```
POST /api/v1/datasets
```

Request Body:

```json
{
  "title": "New Dataset",
  "description": "Description of the new dataset",
  "tags": ["tag1", "tag2"]
}
```

Response:

```json
{
  "id": "new_dataset_id",
  "title": "New Dataset",
  "description": "Description of the new dataset",
  "tags": ["tag1", "tag2"],
  "downloads": 0,
  "createdAt": "2023-06-15T00:00:00Z",
  "uploadUrl": "https://storage.blockchainml.com/upload/new_dataset_id"
}
```

#### Download Dataset

```
GET /api/v1/datasets/:id/download
```

Response:

```json
{
  "downloadUrl": "https://storage.blockchainml.com/download/dataset_id.csv"
}
```

### Version Control

#### Create Version

```
POST /api/v1/datasets/:id/versions
```

Request Body:

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

The API uses conventional HTTP response codes to indicate the success or failure of requests. Codes in the 2xx range indicate success, codes in the 4xx range indicate an error that resulted from the provided information (e.g., missing required parameters, invalid values), and codes in the 5xx range indicate an error with our servers.

Error Response Format:

```json
{
  "error": "Error message here"
}
```

## Rate Limiting

The API implements rate limiting to prevent abuse. The current limit is 100 requests per minute per IP address. If you exceed this limit, you'll receive a 429 (Too Many Requests) response.

Rate limit headers are included in all responses:

- `X-RateLimit-Limit`: The maximum number of requests you're permitted to make per minute.
- `X-RateLimit-Remaining`: The number of requests remaining in the current rate limit window.
- `X-RateLimit-Reset`: The time at which the current rate limit window resets in UTC epoch seconds.

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
  isPrivate: false,
});

// Upload files
const { uploadUrls } = await client.datasets.getUploadUrls(dataset.id, files);
await client.datasets.uploadFiles(uploadUrls);

// Create version
await client.datasets.createVersion(dataset.id, {
  version: "1.0.0",
  changes: "Initial release",
});
```

## Best Practices

- Use chunked upload for large files
- Implement proper error handling
- Monitor upload/download progress
- Validate files before upload
- Use versioning for dataset changes

## Contributing

We welcome contributions! Please see our contributing guidelines for more details.

## This documentation provides a comprehensive overview of your BlockchainML API, including authentication methods, available endpoints, error handling, rate limiting, and usage examples. You should customize this documentation based on the specific features and requirements of your API. Remember to keep it updated as you add new features or make changes to existing endpoints.

Made with ❤️ by the BlockchainML team
