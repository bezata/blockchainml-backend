import { expect, test, describe } from "bun:test";
import { app } from "../src/index";

describe("BlockchainML API", () => {
  test("GET / returns welcome message", async () => {
    const response = await app.handle(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).toBe("Welcome to BlockchainML API");
  });

  test("POST /api/v1/users/register creates a new user and returns API key", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/users/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "test@example.com",
          name: "Test User",
        }),
      })
    );
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.user).toBeDefined();
    expect(json.apiKey).toBeDefined();
  });

  test("GET /api/v1/datasets returns 401 without API key", async () => {
    const response = await app.handle(
      new Request("http://localhost/api/v1/datasets")
    );
    expect(response.status).toBe(401);
    const json = await response.json();
    expect(json).toEqual({ error: "API key is required" });
  });

  test("GET /api/v1/datasets returns 200 with valid API key", async () => {
    // First, register a new user to get a valid API key
    const registerResponse = await app.handle(
      new Request("http://localhost/api/v1/users/register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "testuser@example.com",
          name: "Test User",
        }),
      })
    );
    const { apiKey } = await registerResponse.json();

    // Now use this API key to access the datasets endpoint
    const headers = new Headers();
    headers.append("x-api-key", apiKey);
    const response = await app.handle(
      new Request("http://localhost/api/v1/datasets", { headers })
    );
    expect(response.status).toBe(200);
  });
});
