import { rateLimit } from "elysia-rate-limit";

export const rateLimiter = rateLimit({
  duration: 60000, // 1 minute in milliseconds
  max: 100, // maximum of 100 requests per minute
  errorResponse:
    "Enhance your calm: Too many requests, please try again later.",
  headers: true,
  // You can customize the generator if needed, e.g., for handling proxies
  // generator: (req) => req.headers.get('CF-Connecting-IP') ?? req.headers.get('X-Forwarded-For') ?? '',
  // Optionally, you can define custom skip logic
  // skip: (req) => req.url.includes('/public'),
});
