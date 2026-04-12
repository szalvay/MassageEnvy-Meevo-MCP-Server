import puppeteer, { Browser, Page } from "puppeteer";
import { mkdirSync, writeFileSync, existsSync, readdirSync } from "fs";
import { join } from "path";
import { MEEVO_APP_URL, MEEVO_REPORT_URL, REPORTS, CATEGORY_FILTERS, type ReportParamOpts } from "./config.js";

interface EmployeeCategory {
  id: string;
  name: string;
  employeeIds: string[];
}

interface Session {
  browser: Browser;
  page: Page;
  sessionId: string;
  bearerToken: string;
  lastActive: number;
  downloadDir: string;
  // Cached from the report form during login
  payPeriodGUID: string;
  employeeGUIDs: string[];
  categoryGUIDs: string[];
  categoryMap: Record<string, string>; // category name (lowercase) → GUID
  payPeriodYear: number;
  // Employee categories with their GUIDs for filtering
  spEmployeeIds: string[];   // Service providers (LMT, Esty, Stretch)
  fdaEmployeeIds: string[];  // Front desk associates
  estyEmployeeIds: string[]; // Estheticians only
}

export class MeevoClient {
  private sessions = new Map<string, Session>();

  private getCredentials(clinic: string) {
    const prefix = `MEEVO_${clinic}`;
    const username = process.env[`${prefix}_USERNAME`];
    const password = process.env[`${prefix}_PASSWORD`];
    if (!username || !password) {
      throw new Error(`Missing credentials for clinic ${clinic}. Set ${prefix}_USERNAME and ${prefix}_PASSWORD`);
    }
    return { username, password };
  }

  async login(clinic: string): Promise<string> {
    // Close existing session if any
    await this.closeSession(clinic);

    const { username, password } = this.getCredentials(clinic);
    const defaultDir = join(process.env.HOME || process.env.USERPROFILE || ".", "Desktop", "meevo-mcp-server", "downloads");
    const downloadDir = join(process.env.MEEVO_DOWNLOAD_DIR || defaultDir, clinic);
    mkdirSync(downloadDir, { recursive: true });

    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();

    // Set download behavior
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
    });

    // Spoof a real Chrome user-agent to avoid "Unsupported Browser" dialog
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

    // Navigate to login — tenant ID 2 is Massage Envy
    await page.goto(`${MEEVO_APP_URL}/login/2`, { waitUntil: "networkidle2", timeout: 30000 });

    // Dismiss cookie banner if present
    await page.evaluate(() => {
      const gotIt = Array.from(document.querySelectorAll("a, button")).find(
        (el) => el.textContent?.trim().toLowerCase() === "got it!"
      ) as HTMLElement | undefined;
      if (gotIt) gotIt.click();
    });
    await new Promise((r) => setTimeout(r, 500));

    // Dismiss "Unsupported Browser" / "Continue Anyway" if present
    await page.evaluate(() => {
      const cont = Array.from(document.querySelectorAll("a, button, span")).find(
        (el) => el.textContent?.trim().toLowerCase().includes("continue anyway")
      ) as HTMLElement | undefined;
      if (cont) cont.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    // Wait for login form
    await page.waitForSelector('input[name="userNameField"]', { timeout: 15000 });
    await new Promise((r) => setTimeout(r, 500));

    // Click and type into each field (character by character so Angular binds)
    // First, find visible username field and click it
    const userField = await page.evaluateHandle(() => {
      const fields = document.querySelectorAll('input[name="userNameField"]');
      for (const f of fields) {
        if ((f as HTMLElement).offsetParent !== null) return f;
      }
      return fields[0];
    });
    await (userField as any).click();
    await page.keyboard.type(username, { delay: 30 });

    // Tab to password field and type
    await page.keyboard.press("Tab");
    await page.keyboard.type(password, { delay: 30 });

    // Debug screenshot after filling fields
    await page.screenshot({ path: join(downloadDir, "debug_01_login_filled.png") });

    // Submit
    await page.keyboard.press("Enter");

    // Wait for dashboard to load
    await new Promise((r) => setTimeout(r, 5000));

    // Dismiss ALL popups aggressively
    // 1. Try clicking "No, thanks" / "Got it" / close buttons via JS
    await page.evaluate(() => {
      // Try all clickable elements
      document.querySelectorAll("a, button, span, div, p").forEach((el) => {
        const text = (el as HTMLElement).textContent?.trim().toLowerCase() || "";
        if (text === "no, thanks" || text === "no thanks" || text === "got it!" || text === "got it") {
          (el as HTMLElement).click();
        }
      });
      // Try clicking any close/X buttons
      document.querySelectorAll('[class*="close"], [class*="dismiss"], .cc-dismiss').forEach((el) => {
        (el as HTMLElement).click();
      });
    });
    await new Promise((r) => setTimeout(r, 1000));

    // 2. Press Escape multiple times to dismiss overlays
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));
    await page.keyboard.press("Escape");
    await new Promise((r) => setTimeout(r, 500));

    // 3. If the WalkMe popup is still there, click outside it
    await page.mouse.click(400, 400);
    await new Promise((r) => setTimeout(r, 500));

    // 4. Try once more with broader selector
    await page.evaluate(() => {
      // WalkMe uses iframes sometimes — check for walkme elements
      document.querySelectorAll('[id*="walkme"], [class*="walkme"], [class*="wm-"]').forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
      // Hide any modal overlays
      document.querySelectorAll('[class*="modal"], [class*="overlay"], [class*="backdrop"]').forEach((el) => {
        (el as HTMLElement).style.display = "none";
      });
    });
    await new Promise((r) => setTimeout(r, 500));

    await page.screenshot({ path: join(downloadDir, "debug_02_after_login.png") });
    console.error(`[meevo] After login: url=${page.url()}`);

    // Navigate to reports to grab sessionId + form data
    const data = await this.extractSessionData(page, downloadDir);

    this.sessions.set(clinic, {
      browser,
      page,
      sessionId: data.sessionId,
      bearerToken: data.bearerToken,
      lastActive: Date.now(),
      downloadDir,
      payPeriodGUID: data.payPeriodGUID,
      employeeGUIDs: data.employeeGUIDs,
      categoryGUIDs: data.categoryGUIDs,
      categoryMap: data.categoryMap,
      payPeriodYear: data.payPeriodYear,
      spEmployeeIds: [],
      fdaEmployeeIds: [],
      estyEmployeeIds: [],
    });

    // Log discovered categories for debugging
    const catNames = Object.keys(data.categoryMap);
    console.error(`[meevo] ${clinic}: ${catNames.length} categories discovered: ${catNames.join(", ")}`);

    return data.sessionId;
  }

  private async extractSessionData(page: Page, downloadDir: string): Promise<{
    sessionId: string;
    bearerToken: string;
    payPeriodGUID: string;
    employeeGUIDs: string[];
    categoryGUIDs: string[];
    categoryMap: Record<string, string>;
    payPeriodYear: number;
  }> {
    // Close the Smart Center overlay first
    const smartCenterClose = await page.$('.smart-center-close, [class*="smart-center"] .close, .sc-close');
    if (smartCenterClose) {
      await smartCenterClose.click().catch(() => {});
      await new Promise((r) => setTimeout(r, 1000));
    }

    // Navigate directly to report manager URL instead of using search bar
    // Use hash navigation since Meevo is an Angular SPA
    await page.evaluate(() => {
      // Try closing Smart Center via Angular
      const closeBtn = document.querySelector('[ng-click*="closeSmartCenter"], [ng-click*="close"]');
      if (closeBtn) (closeBtn as HTMLElement).click();
    });
    await new Promise((r) => setTimeout(r, 500));

    // Use the search bar with evaluate to avoid click issues
    await page.evaluate(() => {
      const input = document.querySelector('input[placeholder*="Tell Meevo"]') as HTMLInputElement;
      if (input) {
        input.value = "DE044";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        // Simulate Enter key
        input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keyup", { key: "Enter", code: "Enter", keyCode: 13, bubbles: true }));
      }
    });
    await new Promise((r) => setTimeout(r, 3000));

    await page.screenshot({ path: join(downloadDir, "debug_03_after_search.png") });

    // Extract sessionId and bearerToken from the form
    let { sessionId, bearerToken } = await page.evaluate(() => {
      const sid = (document.querySelector('input[name="sessionId"]') as HTMLInputElement)?.value || "";
      const bt = (document.querySelector('input[name="bearerToken"]') as HTMLInputElement)?.value || "";
      return { sessionId: sid, bearerToken: bt };
    });

    if (!sessionId) {
      // Try clicking a report card
      await page.evaluate(() => {
        const cards = document.querySelectorAll("md-card");
        for (const card of cards) {
          if (card.textContent?.includes("DE044") || card.textContent?.includes("Employee Commission")) {
            (card as HTMLElement).click();
            return;
          }
        }
        if (cards.length > 0) (cards[0] as HTMLElement).click();
      });
      await new Promise((r) => setTimeout(r, 3000));

      await page.screenshot({ path: join(downloadDir, "debug_04_after_card_click.png") });

      const retry = await page.evaluate(() => {
        const sid = (document.querySelector('input[name="sessionId"]') as HTMLInputElement)?.value || "";
        const bt = (document.querySelector('input[name="bearerToken"]') as HTMLInputElement)?.value || "";
        return { sessionId: sid, bearerToken: bt };
      });
      sessionId = retry.sessionId;
      bearerToken = retry.bearerToken;
    }

    if (!sessionId) {
      console.error(`[meevo] Session extract failed. URL: ${page.url()}`);
      throw new Error("Could not extract sessionId. Check debug screenshots in downloads/0014/");
    }

    // Wait for Angular to fully initialize the report controller
    await new Promise((r) => setTimeout(r, 5000));

    // Force Angular to serialize form data by triggering a dry-run submission.
    // 1. Neuter the form (change action to '#' and target to '' so nothing actually happens)
    // 2. Call Angular's submitForm() which serializes all model data into hidden inputs
    // 3. Read the now-populated hidden fields
    // 4. Restore the form
    const formData = await page.evaluate(() => {
      try {
        const formEl = document.querySelector('form[action*="LoadReport"]') as HTMLFormElement;
        if (!formEl) return { error: "no form found" };

        const ang = (window as any).angular;
        if (!ang) return { error: "angular not available" };

        const scope = ang.element(formEl).scope();
        if (!scope?.reports) return { error: "no reports scope" };

        // Get bearerToken (always available)
        const bt = scope.reports.bearerToken || "";

        // Save original form props
        const origAction = formEl.action;
        const origTarget = formEl.target;

        // Neuter the form so submit does nothing
        formEl.action = "javascript:void(0)";
        formEl.target = "";

        // Also block window.open just in case
        const origOpen = window.open;
        (window as any).open = () => null;

        // Trigger Angular's submitForm to serialize all data
        if (typeof scope.reports.submitForm === "function") {
          scope.reports.submitForm();
          try { scope.$apply(); } catch {}
        }

        // Read the now-populated hidden inputs
        const paramsVal = (formEl.querySelector('[name="reportParams"]') as HTMLInputElement)?.value || "";
        const btVal = (formEl.querySelector('[name="bearerToken"]') as HTMLInputElement)?.value || bt;

        // Restore form
        formEl.action = origAction;
        formEl.target = origTarget;
        (window as any).open = origOpen;

        if (!paramsVal) {
          return { error: "submitForm did not populate reportParams", bearerToken: bt };
        }

        const rp = JSON.parse(paramsVal);

        // Extract category name → GUID mapping from Angular model
        const catMap: Record<string, string> = {};
        try {
          const cats = scope.reports.employeeCategories
            || scope.reports.payPeriodEmployeeCategories
            || scope.reports.EmployeeCategories
            || [];
          for (const cat of cats) {
            const name = (cat.name || cat.displayName || cat.categoryName || "").toLowerCase().trim();
            const id = cat.id || cat.guid || cat.employeeCategoryId || "";
            if (name && id) catMap[name] = String(id);
          }
        } catch {}
        // Also try the scope's model data directly
        if (Object.keys(catMap).length === 0) {
          try {
            const model = scope.reports.model || scope.reports;
            const catArrays = [
              model.employeeCategories, model.payPeriodEmployeeCategories,
              model.EmployeeCategoryList, model.PayPeriodEmployeeCategories,
            ].filter(Boolean);
            for (const arr of catArrays) {
              if (!Array.isArray(arr)) continue;
              for (const cat of arr) {
                const name = (cat.name || cat.displayName || cat.categoryName || "").toLowerCase().trim();
                const id = cat.id || cat.guid || cat.employeeCategoryId || "";
                if (name && id) catMap[name] = String(id);
              }
              if (Object.keys(catMap).length > 0) break;
            }
          } catch {}
        }

        return {
          source: "dry_run_submit",
          bearerToken: btVal,
          payPeriodGUID: rp.PayPeriodSelected_TBL || "",
          employeeGUIDs: rp.PayPeriodEmployees_TBL || rp.EmployeeList_TBL || rp.EmployeeCList_TBL || [],
          categoryGUIDs: rp.PayPeriodEmployeeCategories_TBL || rp.EmployeeCategoryList_TBL || [],
          categoryMap: catMap,
          payPeriodYear: rp.PayPeriodYear || new Date().getFullYear(),
        };
      } catch (e: any) {
        return { error: e.message };
      }
    });

    const catMap = formData?.categoryMap || {};
    console.error(`[meevo] Extraction: ${JSON.stringify({
      source: formData?.source, error: formData?.error,
      payPeriod: formData?.payPeriodGUID, employees: formData?.employeeGUIDs?.length,
      categories: Object.keys(catMap).length,
      categoryNames: Object.keys(catMap),
      bearer: formData?.bearerToken ? "yes" : "NO"
    })}`);

    return {
      sessionId,
      bearerToken: formData?.bearerToken || bearerToken,
      payPeriodGUID: formData?.payPeriodGUID || "",
      employeeGUIDs: formData?.employeeGUIDs || [],
      categoryGUIDs: formData?.categoryGUIDs || [],
      categoryMap: catMap,
      payPeriodYear: formData?.payPeriodYear || new Date().getFullYear(),
    };
  }

  async downloadReport(
    clinic: string,
    reportCode: string,
    params: ReportParamOpts,
    outputDir?: string,
    variant?: string
  ): Promise<string> {
    let session = this.sessions.get(clinic);
    if (!session) {
      await this.login(clinic);
      session = this.sessions.get(clinic)!;
    }

    const report = REPORTS[reportCode];
    if (!report) {
      throw new Error(`Unknown report code: ${reportCode}. Valid codes: ${Object.keys(REPORTS).join(", ")}`);
    }

    const targetDir = outputDir || session.downloadDir;
    mkdirSync(targetDir, { recursive: true });

    // DE044 needs payroll period GUID that only Angular can serialize — skip it
    if (reportCode === "DE044") {
      throw new Error("MANUAL PULL REQUIRED — DE044 needs Angular form interaction");
    }

    // All other reports: use direct HTTP POST (faster, no browser needed)
    // Resolve category filter → specific category GUIDs for this report
    const filterName = params.categoryFilter || report.categoryFilter;
    let filteredCategoryGUIDs = params.categoryGUIDs || session.categoryGUIDs;

    if (filterName && filterName !== "none" && CATEGORY_FILTERS[filterName] && Object.keys(session.categoryMap).length > 0) {
      const patterns = CATEGORY_FILTERS[filterName];
      filteredCategoryGUIDs = [];
      for (const [catName, catGuid] of Object.entries(session.categoryMap)) {
        if (patterns.some((p) => catName.includes(p.toLowerCase()))) {
          filteredCategoryGUIDs.push(catGuid);
        }
      }
      console.error(`[meevo] Report ${reportCode}: filter=${filterName} → ${filteredCategoryGUIDs.length} categories (${patterns.join(", ")})`);
    }

    const enrichedParams: ReportParamOpts = {
      ...params,
      employeeGUIDs: params.employeeGUIDs || session.employeeGUIDs,
      categoryGUIDs: filteredCategoryGUIDs,
      payPeriodGUID: params.payPeriodGUID || session.payPeriodGUID,
      payPeriodYear: params.payPeriodYear || session.payPeriodYear,
      allEmployees: filterName === "none" ? undefined : params.allEmployees,
    };

    // Build report params
    const reportParams = report.buildParams(enrichedParams);
    console.error(`[meevo] Report ${reportCode}: payPeriodGUID=${enrichedParams.payPeriodGUID}, employees=${enrichedParams.employeeGUIDs?.length}, categories=${filteredCategoryGUIDs.length}`);

    // Get cookies from browser session for direct HTTP request
    const cookies = await session.page.cookies();
    const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");

    // Build form data — include bearerToken (required for auth)
    const formBody = new URLSearchParams({
      id: report.id,
      shortCut: report.code,
      sessionId: session.sessionId,
      bearerToken: session.bearerToken,
      reportParams: JSON.stringify(reportParams),
      reportFormat: "XLSX",
    });

    // Direct HTTP POST — no browser DOM needed
    const url = `${MEEVO_REPORT_URL}/${report.code}`;
    console.error(`[meevo] Downloading ${report.code} from ${url}`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: formBody.toString(),
    });

    if (!response.ok) {
      throw new Error(`Report download failed: HTTP ${response.status} ${response.statusText}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    // Check if response is an error (JSON) instead of XLSX
    const firstBytes = buffer.slice(0, 10).toString("utf-8");
    if (firstBytes.startsWith("{") || firstBytes.startsWith("<")) {
      const errorText = buffer.toString("utf-8").substring(0, 500);
      throw new Error(`Meevo returned error instead of XLSX: ${errorText}`);
    }

    // Build filename: {clinic}_{report}_{variant}.XLSX (matching existing convention)
    const suffix = variant ? `_${variant}` : "";
    const filename = `${clinic}_${report.code}${suffix}.XLSX`;

    const filePath = join(targetDir, filename);
    writeFileSync(filePath, buffer);

    session.lastActive = Date.now();

    return filePath;
  }


  // For DE044/DE040: Angular must serialize the form params.
  // Strategy: override HTMLFormElement.prototype.submit to capture the serialized
  // form data when Angular calls submit(), then cancel the submission and use
  // our direct HTTP approach with the captured params.
  private async downloadReportViaBrowser(
    session: Session,
    clinic: string,
    reportCode: string,
    targetDir: string,
    variant?: string
  ): Promise<string> {
    const page = session.page;

    // Navigate to the report if not already there
    const currentShortcut = await page.evaluate(() => {
      const f = document.querySelector('form[action*="LoadReport"]');
      return (f?.querySelector('[name="shortCut"]') as HTMLInputElement)?.value || "";
    });

    if (currentShortcut !== reportCode) {
      await page.evaluate(() => {
        const input = document.querySelector('input[placeholder*="Tell Meevo"]') as HTMLInputElement;
        if (input) { input.focus(); input.click(); input.select(); }
      });
      await new Promise((r) => setTimeout(r, 300));
      await page.keyboard.down("Control");
      await page.keyboard.press("a");
      await page.keyboard.up("Control");
      await page.keyboard.type(reportCode, { delay: 30 });
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 5000));
    }

    // Ensure format is XLSX
    await page.evaluate(() => {
      const form = document.querySelector('form[action*="LoadReport"]') as HTMLFormElement;
      if (!form) return;
      const formatField = form.querySelector('[name="reportFormat"]') as HTMLInputElement;
      if (formatField) formatField.value = "XLSX";
    });

    // Install interceptors for BOTH submit paths:
    // 1. submit EVENT (fired by button click) — catches native form submission
    // 2. submit METHOD override — catches programmatic form.submit() calls
    await page.evaluate(() => {
      (window as any).__meevoCapturedForm = null;

      // Path 1: Listen for submit event (native button-click submission)
      const form = document.querySelector('form[action*="LoadReport"]') as HTMLFormElement;
      if (form) {
        form.addEventListener("submit", (e) => {
          e.preventDefault();
          e.stopPropagation();
          const data: Record<string, string> = {};
          form.querySelectorAll("input").forEach((inp: any) => {
            if (inp.name) data[inp.name] = inp.value;
          });
          (window as any).__meevoCapturedForm = data;
        }, true); // useCapture=true to run before Angular's handler
      }

      // Path 2: Override prototype submit (programmatic submission)
      const origSubmit = HTMLFormElement.prototype.submit;
      HTMLFormElement.prototype.submit = function(this: HTMLFormElement) {
        if (this.action?.includes("LoadReport")) {
          const data: Record<string, string> = {};
          this.querySelectorAll("input").forEach((inp: any) => {
            if (inp.name) data[inp.name] = inp.value;
          });
          (window as any).__meevoCapturedForm = data;
        } else {
          origSubmit.call(this);
        }
      };

      // Block window.open as fallback
      (window as any).__origOpen = window.open;
      window.open = (() => null) as any;
    });

    // Click "Run report" — Angular serializes params, one of our interceptors catches it
    await page.evaluate(() => {
      const btn = document.querySelector('button[type="submit"].button-green') as HTMLButtonElement;
      if (btn) btn.click();
    });

    // Wait for Angular to process and call submit
    await new Promise((r) => setTimeout(r, 3000));

    // Read the captured form data
    const captured = await page.evaluate(() => {
      const data = (window as any).__meevoCapturedForm;
      // Restore original functions
      // (we leave the override in place in case we need it again)
      window.open = (window as any).__origOpen || window.open;
      return data;
    });

    if (!captured || !captured.reportParams) {
      console.error(`[meevo] Captured form data: ${JSON.stringify(captured)}`);
      throw new Error(`Failed to capture form submission for ${reportCode}. Angular may not have serialized params.`);
    }

    console.error(`[meevo] Captured ${reportCode} form! reportParams length=${captured.reportParams.length}, bearerToken=${captured.bearerToken ? 'yes' : 'no'}`);

    // Now use our direct HTTP POST with the captured params
    const cookies = await page.cookies();
    const cookieHeader = cookies.map((c: any) => `${c.name}=${c.value}`).join("; ");

    const formBody = new URLSearchParams(captured);
    const url = `${MEEVO_REPORT_URL}/${reportCode}`;

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookieHeader,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      },
      body: formBody.toString(),
    });

    if (!response.ok) {
      throw new Error(`Report download failed: HTTP ${response.status}`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());

    const firstBytes = buffer.slice(0, 10).toString("utf-8");
    if (firstBytes.startsWith("{") || firstBytes.startsWith("<")) {
      const errorText = buffer.toString("utf-8").substring(0, 500);
      throw new Error(`Meevo returned error: ${errorText}`);
    }

    const suffix = variant ? `_${variant}` : "";
    const filename = `${clinic}_${reportCode}${suffix}.XLSX`;
    const filePath = join(targetDir, filename);
    writeFileSync(filePath, buffer);

    session.lastActive = Date.now();
    return filePath;
  }

  private async waitForNewFile(dir: string, filesBefore: Set<string>, timeoutMs: number): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!existsSync(dir)) continue;
      const currentFiles = readdirSync(dir);
      const newFiles = currentFiles.filter(
        f => !filesBefore.has(f) && !f.endsWith(".crdownload") && !f.endsWith(".tmp")
      );
      if (newFiles.length > 0) {
        return join(dir, newFiles[0]);
      }
    }
    throw new Error(`Download timed out after ${timeoutMs / 1000}s`);
  }

  async closeSession(clinic: string): Promise<void> {
    const session = this.sessions.get(clinic);
    if (session) {
      await session.browser.close().catch(() => {});
      this.sessions.delete(clinic);
    }
  }

  async closeAll(): Promise<void> {
    for (const clinic of this.sessions.keys()) {
      await this.closeSession(clinic);
    }
  }

  getActiveSessions(): Array<{ clinic: string; lastActive: number; sessionId: string }> {
    return Array.from(this.sessions.entries()).map(([clinic, s]) => ({
      clinic,
      lastActive: s.lastActive,
      sessionId: s.sessionId.substring(0, 8) + "...",
    }));
  }

  hasSession(clinic: string): boolean {
    return this.sessions.has(clinic);
  }

  // Extract employee categories and their employee GUIDs from a clinic
  // Uses Meevo's internal API via fetch from within the authenticated page context
  async getEmployeeCategories(clinic: string): Promise<Array<{ name: string; id: string; employeeGuids: string[] }>> {
    let session = this.sessions.get(clinic);
    if (!session) {
      await this.login(clinic);
      session = this.sessions.get(clinic)!;
    }

    const page = session.page;

    // Try multiple Meevo API endpoints to find employee categories
    const result = await page.evaluate(async () => {
      const endpoints = [
        "/api/Employee/Category/List",
        "/api/EmployeeCategory/List",
        "/api/Employee/Categories",
        "/api/employees/categories",
        "/api/Report/EmployeeCategories",
        "/api/Employee/Category",
        "/api/payroll/employeecategories",
        "/api/Report/PayPeriod/EmployeeCategories",
        "/api/EmployeeCategories",
      ];

      for (const ep of endpoints) {
        try {
          const r = await fetch("https://me.meevo.com" + ep, {
            method: "GET",
            credentials: "include",
            headers: { "Accept": "application/json" },
          });
          if (r.ok) {
            const data = await r.json();
            return { endpoint: ep, data };
          }
          // Also try POST
          const r2 = await fetch("https://me.meevo.com" + ep, {
            method: "POST",
            credentials: "include",
            headers: { "Accept": "application/json", "Content-Type": "application/json" },
            body: "{}",
          });
          if (r2.ok) {
            const data = await r2.json();
            return { endpoint: ep + " (POST)", data };
          }
        } catch {}
      }
      return { endpoint: "none found", data: null };
    });

    console.error(`[meevo] Category API result: endpoint=${result.endpoint}, hasData=${!!result.data}`);

    if (result.data) {
      // Parse the API response into our format
      const categories: Array<{ name: string; id: string; employeeGuids: string[] }> = [];
      const data = result.data;

      // Handle various response formats
      const items = Array.isArray(data) ? data : data.items || data.categories || data.result || [];
      for (const item of items) {
        categories.push({
          name: item.name || item.displayName || item.categoryName || "",
          id: item.id || item.guid || item.employeeCategoryId || "",
          employeeGuids: item.employees?.map((e: any) => e.id || e.guid || e.employeeId) || [],
        });
      }

      return categories;
    }

    // Fallback: try to read from the Angular scope on the current page
    const scopeData = await page.evaluate(() => {
      const ang = (window as any).angular;
      if (!ang) return null;

      // Walk all scopes looking for employee category data
      const results: any[] = [];
      const visited = new Set();

      function walkScope(s: any) {
        if (!s || visited.has(s.$id)) return;
        visited.add(s.$id);

        const keys = Object.keys(s).filter(k => !k.startsWith("$") && !k.startsWith("_"));
        for (const k of keys) {
          const v = s[k];
          if (Array.isArray(v) && v.length > 0 && v[0]?.employeeCategoryId) {
            results.push({ key: k, items: v.map((i: any) => ({ id: i.employeeCategoryId || i.id, name: i.name || i.displayName, empCount: i.employees?.length || 0 })) });
          }
          if (Array.isArray(v) && v.length > 0 && v[0]?.categoryName) {
            results.push({ key: k, items: v.map((i: any) => ({ id: i.id || i.guid, name: i.categoryName || i.name, empCount: i.employees?.length || 0 })) });
          }
        }

        // Check children
        let child = s.$$childHead;
        while (child) {
          walkScope(child);
          child = child.$$nextSibling;
        }
      }

      const rootScope = ang.element(document.body).scope()?.$root;
      if (rootScope) walkScope(rootScope);
      return results;
    });

    if (scopeData && scopeData.length > 0) {
      console.error(`[meevo] Found categories via scope walk: ${JSON.stringify(scopeData[0].items.map((i: any) => i.name))}`);
      return scopeData[0].items.map((i: any) => ({
        name: i.name,
        id: String(i.id),
        employeeGuids: [],
      }));
    }

    throw new Error("Could not find employee categories via API or Angular scope");
  }
}
