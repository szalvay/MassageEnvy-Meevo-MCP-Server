import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { MeevoClient } from "./client.js";
import { registerSessionTools } from "./tools/session.js";
import { registerReportTools } from "./tools/reports.js";

import { readFileSync, existsSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

// Load .env file if present
const __dirname = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dirname, "..", ".env");
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, "utf-8");
  for (const line of envContent.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq > 0) {
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim();
      if (!process.env[key]) process.env[key] = val;
    }
  }
}

const client = new MeevoClient();

const server = new McpServer({
  name: "meevo",
  version: "1.0.0",
});

registerSessionTools(server, client);
registerReportTools(server, client);

// Cleanup on exit
process.on("SIGINT", async () => {
  await client.closeAll();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await client.closeAll();
  process.exit(0);
});

const transport = new StdioServerTransport();
await server.connect(transport);
