# BlockchainML API Documentation

## Table of Contents

1. [Introduction](#introduction)
2. [Authentication](#authentication)
3. [API Endpoints](#api-endpoints)
   - [Datasets](#datasets)
   - [Users](#users)
   - [Trending](#trending)
4. [Error Handling](#error-handling)
5. [Rate Limiting](#rate-limiting)
6. [OpenTelemetry Integration](#opentelemetry-integration)
7. [Security Considerations](#security-considerations)
8. [Examples](#examples)

## Introduction

The BlockchainML API provides access to blockchain-related datasets and machine learning models. This API is built using Elysia, a performant Node.js web framework, and integrates various features such as authentication, rate limiting, and OpenTelemetry for observability.

Base URL: `https://api.blockchainml.com/v1`

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

### Users

#### Register User

```
POST /api/v1/users/register
```

Request Body:
```json
{
  "email": "user@example.com",
  "password": "securepassword",
  "name": "John Doe"
}
```

Response:
```json
{
  "id": "user_id",
  "email": "user@example.com",
  "name": "John Doe",
  "apiKey": "your_api_key_here"
}
```

### Trending

#### Get Trending Datasets

```
GET /api/v1/trending/datasets
```

Query Parameters:
- `limit` (optional): Number of trending datasets to return (default: 10)

Response:
```json
{
  "datasets": [
    {
      "id": "dataset_id",
      "title": "Trending Dataset",
      "downloads": 1000,
      "trendScore": 95.5
    }
  ]
}
```

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

## OpenTelemetry Integration

The API is instrumented with OpenTelemetry for observability. This allows for distributed tracing and performance monitoring. If you're integrating with our API and have OpenTelemetry set up in your system, you can correlate traces between your application and our API.

## Security Considerations

- Always use HTTPS for API requests to ensure data privacy.
- Keep your API key secure and don't share it publicly.
- Implement proper input validation and sanitization in your applications when sending data to the API.

## Examples

### Curl

List datasets:
```bash
curl -H "Authorization: Bearer YOUR_API_KEY" https://api.blockchainml.com/v1/api/v1/datasets
```

Create a dataset:
```bash
curl -X POST -H "Authorization: Bearer YOUR_API_KEY" -H "Content-Type: application/json" -d '{"title":"New Dataset","description":"A new dataset","tags":["blockchain","finance"]}' https://api.blockchainml.com/v1/api/v1/datasets
```

### Python (using requests library)

```python
import requests

API_KEY = 'YOUR_API_KEY'
BASE_URL = 'https://api.blockchainml.com/v1'

headers = {
    'Authorization': f'Bearer {API_KEY}'
}

# List datasets
response = requests.get(f'{BASE_URL}/api/v1/datasets', headers=headers)
datasets = response.json()

# Get a specific dataset
dataset_id = 'some_dataset_id'
response = requests.get(f'{BASE_URL}/api/v1/datasets/{dataset_id}', headers=headers)
dataset = response.json()

# Create a new dataset
new_dataset = {
    'title': 'New Dataset',
    'description': 'A new dataset',
    'tags': ['blockchain', 'finance']
}
response = requests.post(f'{BASE_URL}/api/v1/datasets', headers=headers, json=new_dataset)
created_dataset = response.json()
```

This documentation provides a comprehensive overview of your BlockchainML API, including authentication methods, available endpoints, error handling, rate limiting, and usage examples. You should customize this documentation based on the specific features and requirements of your API. Remember to keep it updated as you add new features or make changes to existing endpoints. 
---

Made with ❤️ by the BlockchainML team