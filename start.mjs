// Wrapper that sets env vars and launches the server
// Credentials are loaded from .env file in src/index.ts
// This file exists so settings.json has a clean entry point
await import("./src/index.ts");
