import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MeevoClient } from "../client.js";
import { CLINICS } from "../config.js";
import { textResult, errorResult } from "../types.js";

export function registerSessionTools(server: McpServer, client: MeevoClient) {
  server.tool(
    "meevo_login",
    "Log into a Meevo clinic instance and establish a session for report downloads",
    {
      clinic: z.enum(["0014", "0355", "0360", "0367", "0661"]).describe("Clinic code"),
    },
    async ({ clinic }) => {
      try {
        const sessionId = await client.login(clinic);
        return textResult({
          status: "logged_in",
          clinic,
          name: CLINICS[clinic],
          sessionId: sessionId.substring(0, 8) + "...",
        });
      } catch (e: any) {
        return errorResult(`Login failed for ${clinic} (${CLINICS[clinic]}): ${e.message}`);
      }
    }
  );

  server.tool(
    "meevo_list_sessions",
    "Show which Meevo clinic sessions are currently active",
    {},
    async () => {
      const sessions = client.getActiveSessions();
      if (sessions.length === 0) {
        return textResult({ message: "No active sessions. Use meevo_login to connect to a clinic." });
      }
      return textResult(
        sessions.map((s) => ({
          clinic: s.clinic,
          name: CLINICS[s.clinic],
          lastActive: new Date(s.lastActive).toISOString(),
          sessionId: s.sessionId,
        }))
      );
    }
  );

  server.tool(
    "meevo_logout",
    "Close a Meevo clinic session",
    {
      clinic: z.enum(["0014", "0355", "0360", "0367", "0661"]).describe("Clinic code to disconnect"),
    },
    async ({ clinic }) => {
      try {
        await client.closeSession(clinic);
        return textResult({ status: "logged_out", clinic, name: CLINICS[clinic] });
      } catch (e: any) {
        return errorResult(e.message);
      }
    }
  );
}
