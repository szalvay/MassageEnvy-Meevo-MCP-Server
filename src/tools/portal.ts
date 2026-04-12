import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { PortalClient } from "../portal-client.js";
import { PORTAL_REPORTS, PORTAL_CLINICS, ALL_PORTAL_LOCATIONS } from "../portal-config.js";
import { textResult, errorResult } from "../types.js";

const reportKeys = Object.keys(PORTAL_REPORTS) as [string, ...string[]];
const clinicCodes = Object.keys(PORTAL_CLINICS) as [string, ...string[]];

// Track background downloads
interface DownloadJob {
  id: string;
  report: string;
  status: "running" | "done" | "error";
  file?: string;
  error?: string;
  startedAt: number;
}
const activeJobs = new Map<string, DownloadJob>();
let jobCounter = 0;

export function registerPortalTools(server: McpServer, portalClient: PortalClient) {
  server.tool(
    "portal_login",
    "Log into the Massage Envy Franchisee Portal (portal.meintranet.com)",
    {},
    async () => {
      try {
        await portalClient.login();
        return textResult({ status: "logged_in", portal: "portal.meintranet.com" });
      } catch (e: any) {
        return errorResult(`Portal login failed: ${e.message}`);
      }
    }
  );

  server.tool(
    "portal_list_sessions",
    "Show ME Portal session status",
    {},
    async () => {
      const info = portalClient.getSessionInfo();
      if (!info) return textResult({ status: "not_logged_in", message: "Use portal_login to connect." });
      const jobs = Array.from(activeJobs.values()).map((j) => ({
        id: j.id, report: j.report, status: j.status,
        file: j.file, error: j.error,
        elapsed: `${Math.round((Date.now() - j.startedAt) / 1000)}s`,
      }));
      return textResult({ status: "active", lastActive: new Date(info.lastActive).toISOString(), downloadDir: info.downloadDir, downloads: jobs });
    }
  );

  server.tool(
    "portal_logout",
    "Close the ME Portal browser session",
    {},
    async () => {
      try { await portalClient.close(); return textResult({ status: "logged_out" }); }
      catch (e: any) { return errorResult(e.message); }
    }
  );

  server.tool(
    "portal_pull_report",
    "Download a single SSRS report from the ME Franchisee Portal for specified clinics and date range. Returns immediately with a job ID — use portal_check_download to check when the file is ready.",
    {
      report: z.enum(reportKeys).describe("Report key: scorecard, performance, franchise_settlement, royalty_summary, membership_reconcile, giftcard_reconcile, royalty_rebate"),
      clinics: z.array(z.enum(clinicCodes)).optional().describe("Clinic codes (e.g., ['0014']). Omit for all 5."),
      begin_date: z.string().describe("Begin date (MM/DD/YYYY)"),
      end_date: z.string().describe("End date (MM/DD/YYYY)"),
      collapse_franchise: z.boolean().optional().describe("Collapse Franchise? (Franchise Settlement only)"),
      output_dir: z.string().optional().describe("Output directory"),
    },
    async ({ report, clinics, begin_date, end_date, collapse_franchise, output_dir }) => {
      try {
        if (!portalClient.isLoggedIn()) await portalClient.login();
        const locations = clinics ? clinics.map((c) => PORTAL_CLINICS[c]).filter(Boolean) : ALL_PORTAL_LOCATIONS;

        const jobId = `portal_${++jobCounter}`;
        const job: DownloadJob = { id: jobId, report: PORTAL_REPORTS[report].name, status: "running", startedAt: Date.now() };
        activeJobs.set(jobId, job);

        // Fire and forget — download runs in background
        portalClient.downloadReport(report, {
          locations, beginDate: begin_date, endDate: end_date, collapseFranchise: collapse_franchise,
        }, output_dir).then((filePath) => {
          job.status = "done";
          job.file = filePath;
        }).catch((e) => {
          job.status = "error";
          job.error = e.message;
        });

        return textResult({
          status: "downloading",
          jobId,
          report: PORTAL_REPORTS[report].name,
          locations,
          dateRange: `${begin_date} - ${end_date}`,
          message: "Report is downloading in background. Use portal_check_download to check status.",
        });
      } catch (e: any) {
        return errorResult(`Failed to start ${report} download: ${e.message}`);
      }
    }
  );

  server.tool(
    "portal_check_download",
    "Check the status of a background portal report download. Returns the file path when done.",
    {
      job_id: z.string().optional().describe("Job ID from portal_pull_report. Omit to see all jobs."),
    },
    async ({ job_id }) => {
      if (job_id) {
        const job = activeJobs.get(job_id);
        if (!job) return errorResult(`No job found with ID: ${job_id}`);
        return textResult({
          id: job.id, report: job.report, status: job.status,
          file: job.file, error: job.error,
          elapsed: `${Math.round((Date.now() - job.startedAt) / 1000)}s`,
        });
      }
      // Return all jobs
      const jobs = Array.from(activeJobs.values()).map((j) => ({
        id: j.id, report: j.report, status: j.status,
        file: j.file, error: j.error,
        elapsed: `${Math.round((Date.now() - j.startedAt) / 1000)}s`,
      }));
      return textResult({ jobs });
    }
  );

  server.tool(
    "portal_pull_scorecard",
    "Pull Scorecard Datamart for all 5 clinics. Returns a job ID — use portal_check_download to check status.",
    {
      begin_date: z.string().describe("Begin date (MM/DD/YYYY)"),
      end_date: z.string().describe("End date (MM/DD/YYYY)"),
      output_dir: z.string().optional().describe("Output directory"),
    },
    async ({ begin_date, end_date, output_dir }) => {
      try {
        if (!portalClient.isLoggedIn()) await portalClient.login();
        const jobId = `scorecard_${++jobCounter}`;
        const job: DownloadJob = { id: jobId, report: "Scorecard Datamart (all clinics)", status: "running", startedAt: Date.now() };
        activeJobs.set(jobId, job);

        (async () => {
          const files: string[] = [];
          for (const [code, name] of Object.entries(PORTAL_CLINICS)) {
            try {
              const file = await portalClient.downloadReport("scorecard", { locations: [name], beginDate: begin_date, endDate: end_date }, output_dir);
              files.push(file);
            } catch (e: any) { console.error(`[me-portal] Scorecard ${code} failed: ${e.message}`); }
          }
          job.status = "done";
          job.file = files.join(", ");
        })().catch((e) => { job.status = "error"; job.error = e.message; });

        return textResult({ status: "downloading", jobId, message: "Pulling Scorecard for all 5 clinics. Use portal_check_download to check status." });
      } catch (e: any) { return errorResult(`Scorecard pull failed: ${e.message}`); }
    }
  );

  server.tool(
    "portal_pull_franchise_settlement",
    "Pull Franchise Settlement (NRE) report for all clinics for a week. Returns a job ID.",
    {
      begin_date: z.string().describe("Week begin date (MM/DD/YYYY)"),
      end_date: z.string().describe("Week end date (MM/DD/YYYY)"),
      collapse_franchise: z.boolean().optional().default(true).describe("Collapse Franchise? (default: true)"),
      output_dir: z.string().optional().describe("Output directory"),
    },
    async ({ begin_date, end_date, collapse_franchise, output_dir }) => {
      try {
        if (!portalClient.isLoggedIn()) await portalClient.login();
        const jobId = `nre_${++jobCounter}`;
        const job: DownloadJob = { id: jobId, report: "Franchise Settlement", status: "running", startedAt: Date.now() };
        activeJobs.set(jobId, job);

        portalClient.downloadReport("franchise_settlement", {
          locations: ALL_PORTAL_LOCATIONS, beginDate: begin_date, endDate: end_date, collapseFranchise: collapse_franchise,
        }, output_dir).then((f) => { job.status = "done"; job.file = f; }).catch((e) => { job.status = "error"; job.error = e.message; });

        return textResult({ status: "downloading", jobId, message: "Pulling Franchise Settlement. Use portal_check_download to check status." });
      } catch (e: any) { return errorResult(`Franchise Settlement pull failed: ${e.message}`); }
    }
  );

  server.tool(
    "portal_pull_all_accounting",
    "Pull all 5 Meevo Accounting reports for a week. Returns a job ID.",
    {
      begin_date: z.string().describe("Week begin date (MM/DD/YYYY)"),
      end_date: z.string().describe("Week end date (MM/DD/YYYY)"),
      output_dir: z.string().optional().describe("Output directory"),
    },
    async ({ begin_date, end_date, output_dir }) => {
      try {
        if (!portalClient.isLoggedIn()) await portalClient.login();
        const jobId = `accounting_${++jobCounter}`;
        const job: DownloadJob = { id: jobId, report: "All Accounting Reports", status: "running", startedAt: Date.now() };
        activeJobs.set(jobId, job);

        (async () => {
          const keys = ["franchise_settlement", "royalty_summary", "membership_reconcile", "giftcard_reconcile", "royalty_rebate"];
          const files: string[] = [];
          for (const key of keys) {
            try {
              const file = await portalClient.downloadReport(key, {
                locations: ALL_PORTAL_LOCATIONS, beginDate: begin_date, endDate: end_date,
                collapseFranchise: key === "franchise_settlement" ? true : undefined,
              }, output_dir);
              files.push(file);
            } catch (e: any) { console.error(`[me-portal] ${key} failed: ${e.message}`); }
          }
          job.status = "done";
          job.file = files.join(", ");
        })().catch((e) => { job.status = "error"; job.error = e.message; });

        return textResult({ status: "downloading", jobId, message: "Pulling all 5 accounting reports. Use portal_check_download to check status." });
      } catch (e: any) { return errorResult(`Accounting reports pull failed: ${e.message}`); }
    }
  );
}
