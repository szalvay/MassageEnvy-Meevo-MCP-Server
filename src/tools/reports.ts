import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { MeevoClient } from "../client.js";
import { CLINICS, REPORTS, getWeekBoundaries, getPreviousMonthRange } from "../config.js";
import { textResult, errorResult } from "../types.js";

export function registerReportTools(server: McpServer, client: MeevoClient) {
  server.tool(
    "meevo_pull_report",
    "Download a single Meevo report for a clinic. Returns the file path of the downloaded XLSX.",
    {
      clinic: z.enum(["0014", "0355", "0360", "0367", "0661"]).describe("Clinic code"),
      report_code: z
        .enum(["DE044", "DE040", "MES01", "MES10", "MA060", "AQ246", "MR245", "MR200"])
        .describe("Report code"),
      start_date: z.string().describe("Start date (YYYY-MM-DD)"),
      end_date: z.string().describe("End date (YYYY-MM-DD)"),
      output_dir: z.string().optional().describe("Output directory (optional)"),
    },
    async ({ clinic, report_code, start_date, end_date, output_dir }) => {
      try {
        if (!client.hasSession(clinic)) {
          await client.login(clinic);
        }
        const filePath = await client.downloadReport(clinic, report_code, {
          startDate: start_date,
          endDate: end_date,
          allEmployees: true,
        }, output_dir);
        return textResult({
          status: "downloaded",
          clinic,
          report: report_code,
          file: filePath,
        });
      } catch (e: any) {
        return errorResult(`Failed to pull ${report_code} for ${clinic}: ${e.message}`);
      }
    }
  );

  server.tool(
    "meevo_pull_payroll_reports",
    "Download ALL payroll reports for a single clinic (DE044, DE040 SP/FDA, MES01 per-week, MES10, MA060, AQ246, MR245, MR200 FDA/Esty). Automatically handles date logic.",
    {
      clinic: z.enum(["0014", "0355", "0360", "0367", "0661"]).describe("Clinic code"),
      period_start: z.string().describe("Pay period start date (YYYY-MM-DD), e.g. 2026-04-01"),
      period_end: z.string().describe("Pay period end date (YYYY-MM-DD), e.g. 2026-04-15"),
      output_dir: z.string().describe("Root output directory — files go into {output_dir}/{clinic} - Meevo Reports/"),
    },
    async ({ clinic, period_start, period_end, output_dir }) => {
      try {
        if (!client.hasSession(clinic)) {
          await client.login(clinic);
        }

        const clinicDir = `${output_dir}/${clinic} - Meevo Reports`;
        const results: Array<{ report: string; variant?: string; file?: string; error?: string }> = [];

        // DE044, DE040_SP, DE040_FDA — MANUAL PULL (require specific employee category selection in Meevo UI)
        results.push({ report: "DE044", error: "MANUAL PULL — requires pay period selection in Meevo UI" });
        results.push({ report: "DE040", variant: "SP", error: "MANUAL PULL — requires SP category selection in Meevo UI" });
        results.push({ report: "DE040", variant: "FDA", error: "MANUAL PULL — requires FDA category selection in Meevo UI" });

        // 4. MES01 — per week
        const weeks = getWeekBoundaries(period_start, period_end);
        for (const week of weeks) {
          try {
            const f = await client.downloadReport(clinic, "MES01", {
              startDate: week.start, endDate: week.end, allEmployees: true,
            }, clinicDir, week.label.toLowerCase());
            results.push({ report: "MES01", variant: week.label, file: f });
          } catch (e: any) {
            results.push({ report: "MES01", variant: week.label, error: e.message });
          }
        }

        // 5. MES10 — full pay period
        try {
          const f = await client.downloadReport(clinic, "MES10", {
            startDate: period_start, endDate: period_end, allEmployees: true,
          }, clinicDir);
          results.push({ report: "MES10", file: f });
        } catch (e: any) {
          results.push({ report: "MES10", error: e.message });
        }

        // 6. MA060 — full pay period
        try {
          const f = await client.downloadReport(clinic, "MA060", {
            startDate: period_start, endDate: period_end, allEmployees: true,
          }, clinicDir);
          results.push({ report: "MA060", file: f });
        } catch (e: any) {
          results.push({ report: "MA060", error: e.message });
        }

        // 7. AQ246 — full pay period
        try {
          const f = await client.downloadReport(clinic, "AQ246", {
            startDate: period_start, endDate: period_end,
          }, clinicDir);
          results.push({ report: "AQ246", file: f });
        } catch (e: any) {
          results.push({ report: "AQ246", error: e.message });
        }

        // 8. MR245 — previous full month
        const prevMonth = getPreviousMonthRange(period_start);
        try {
          const f = await client.downloadReport(clinic, "MR245", {
            startDate: prevMonth.start, endDate: prevMonth.end,
          }, clinicDir);
          results.push({ report: "MR245", file: f });
        } catch (e: any) {
          results.push({ report: "MR245", error: e.message });
        }

        // 9. MR200 FDA (Gift Cards) — previous full month
        try {
          const f = await client.downloadReport(clinic, "MR200", {
            startDate: prevMonth.start, endDate: prevMonth.end, allEmployees: true,
          }, clinicDir, "FDA");
          results.push({ report: "MR200", variant: "FDA", file: f });
        } catch (e: any) {
          results.push({ report: "MR200", variant: "FDA", error: e.message });
        }

        // 10. MR200 Esty (Product/Retail) — previous full month
        try {
          const f = await client.downloadReport(clinic, "MR200", {
            startDate: prevMonth.start, endDate: prevMonth.end, allEmployees: true,
          }, clinicDir, "Product");
          results.push({ report: "MR200", variant: "Product", file: f });
        } catch (e: any) {
          results.push({ report: "MR200", variant: "Product", error: e.message });
        }

        const successes = results.filter((r) => r.file).length;
        const failures = results.filter((r) => r.error).length;

        return textResult({
          status: "complete",
          clinic,
          name: CLINICS[clinic],
          period: `${period_start} to ${period_end}`,
          summary: `${successes} reports downloaded, ${failures} failed`,
          results,
        });
      } catch (e: any) {
        return errorResult(`Payroll report pull failed for ${clinic}: ${e.message}`);
      }
    }
  );

  server.tool(
    "meevo_pull_all_clinics",
    "Download ALL payroll reports for ALL 5 clinics sequentially. This is the full payroll report pull.",
    {
      period_start: z.string().describe("Pay period start date (YYYY-MM-DD)"),
      period_end: z.string().describe("Pay period end date (YYYY-MM-DD)"),
      output_dir: z.string().describe("Root output directory for all clinic reports"),
    },
    async ({ period_start, period_end, output_dir }) => {
      const allResults: Array<{ clinic: string; name: string; status: string; details?: unknown }> = [];

      for (const code of Object.keys(CLINICS)) {
        try {
          if (!client.hasSession(code)) {
            await client.login(code);
          }

          // Reuse the single-clinic tool logic
          const clinicDir = `${output_dir}/${code} - Meevo Reports`;
          const reports = [
            { code: "DE044", startDate: period_start, endDate: period_end },
            { code: "DE040", startDate: period_start, endDate: period_end },
            { code: "MES10", startDate: period_start, endDate: period_end },
            { code: "MA060", startDate: period_start, endDate: period_end },
            { code: "AQ246", startDate: period_start, endDate: period_end },
          ];

          let downloaded = 0;
          let failed = 0;

          for (const r of reports) {
            try {
              await client.downloadReport(code, r.code, {
                startDate: r.startDate, endDate: r.endDate, allEmployees: true,
              }, clinicDir);
              downloaded++;
            } catch {
              failed++;
            }
          }

          // MES01 per week
          const weeks = getWeekBoundaries(period_start, period_end);
          for (const week of weeks) {
            try {
              await client.downloadReport(code, "MES01", {
                startDate: week.start, endDate: week.end, allEmployees: true,
              }, clinicDir);
              downloaded++;
            } catch {
              failed++;
            }
          }

          // MR245 + MR200 — prev month
          const prevMonth = getPreviousMonthRange(period_start);
          for (const rCode of ["MR245", "MR200", "MR200"]) {
            try {
              await client.downloadReport(code, rCode, {
                startDate: prevMonth.start, endDate: prevMonth.end, allEmployees: true,
              }, clinicDir);
              downloaded++;
            } catch {
              failed++;
            }
          }

          allResults.push({
            clinic: code,
            name: CLINICS[code],
            status: failed === 0 ? "success" : "partial",
            details: { downloaded, failed },
          });
        } catch (e: any) {
          allResults.push({
            clinic: code,
            name: CLINICS[code],
            status: "failed",
            details: e.message,
          });
        }
      }

      return textResult({
        status: "complete",
        period: `${period_start} to ${period_end}`,
        clinics: allResults,
      });
    }
  );

  server.tool(
    "meevo_pull_mr100",
    "Pull MR100 (Sales Summary) reports for all 5 clinics for the previous calendar month. Used for monthly close revenue recording. The date is auto-calculated: if you run this in May, it pulls April's data.",
    {
      as_of_date: z.string().optional().describe("Reference date (YYYY-MM-DD) to determine which month to pull. Defaults to today. The PREVIOUS month's data is pulled."),
      output_dir: z.string().optional().describe("Output directory for downloaded files"),
    },
    async ({ as_of_date, output_dir }) => {
      const refDate = as_of_date || new Date().toISOString().split("T")[0];
      const { start, end } = getPreviousMonthRange(refDate);

      const allResults: Array<{ clinic: string; name: string; status: string; file?: string; error?: string }> = [];

      for (const code of Object.keys(CLINICS)) {
        try {
          if (!client.hasSession(code)) {
            await client.login(code);
          }

          const clinicDir = output_dir || undefined;
          const file = await client.downloadReport(code, "MR200", {
            startDate: start,
            endDate: end,
            allEmployees: true,
          }, clinicDir);

          allResults.push({ clinic: code, name: CLINICS[code], status: "success", file });
        } catch (e: any) {
          allResults.push({ clinic: code, name: CLINICS[code], status: "failed", error: e.message });
        }
      }

      const ok = allResults.filter((r) => r.file).length;
      const fail = allResults.filter((r) => r.error).length;

      return textResult({
        status: "complete",
        report: "MR100 (Sales Summary)",
        month: `${start} to ${end}`,
        summary: `${ok} clinics downloaded, ${fail} failed`,
        results: allResults,
      });
    }
  );
}
