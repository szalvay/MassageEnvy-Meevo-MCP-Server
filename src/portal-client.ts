import puppeteer, { Browser, Page } from "puppeteer";
import { mkdirSync, writeFileSync, existsSync, readdirSync, renameSync } from "fs";
import { join } from "path";
import { PORTAL_BASE_URL, PORTAL_LOGIN_URL, PORTAL_REPORTS_URL, PORTAL_REPORTS, type PortalReportDef } from "./portal-config.js";

interface PortalSession {
  browser: Browser;
  page: Page;
  lastActive: number;
  downloadDir: string;
}

export interface PortalReportParams {
  locations: string[];
  beginDate: string;
  endDate: string;
  collapseFranchise?: boolean;
}

export class PortalClient {
  private session: PortalSession | null = null;

  private getCredentials() {
    const username = process.env.ME_PORTAL_USERNAME;
    const password = process.env.ME_PORTAL_PASSWORD;
    if (!username || !password) {
      throw new Error("Missing credentials. Set ME_PORTAL_USERNAME and ME_PORTAL_PASSWORD env vars.");
    }
    return { username, password };
  }

  async login(): Promise<void> {
    await this.close();
    const { username, password } = this.getCredentials();
    const defaultDir = join(
      process.env.HOME || process.env.USERPROFILE || ".",
      "Desktop", "claude code", "meevo-mcp-server", "portal-downloads"
    );
    const downloadDir = process.env.ME_PORTAL_DOWNLOAD_DIR || defaultDir;
    mkdirSync(downloadDir, { recursive: true });

    console.error("[me-portal] Launching browser...");
    const browser = await puppeteer.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox"],
    });

    const page = await browser.newPage();
    const cdp = await page.createCDPSession();
    await cdp.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: downloadDir });
    await page.setUserAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36");

    console.error("[me-portal] Navigating to login...");
    await page.goto(PORTAL_LOGIN_URL, { waitUntil: "networkidle2", timeout: 30000 });
    await page.waitForSelector('input[type="email"], input[name="Email"], input#Email', { timeout: 10000 }).catch(() => {});

    const emailSel = await this.findInput(page, ["Email", "UserName", "email", "username"]);
    const passSel = await this.findInput(page, ["Password", "password"]);

    if (emailSel) { await page.click(emailSel); await page.keyboard.type(username, { delay: 20 }); }
    else { const inp = await page.$$('input[type="text"], input[type="email"]'); if (inp.length) { await inp[0].click(); await page.keyboard.type(username, { delay: 20 }); } }

    if (passSel) { await page.click(passSel); await page.keyboard.type(password, { delay: 20 }); }
    else { const inp = await page.$$('input[type="password"]'); if (inp.length) { await inp[0].click(); await page.keyboard.type(password, { delay: 20 }); } }

    await page.keyboard.press("Enter");
    await page.waitForNavigation({ waitUntil: "networkidle2", timeout: 30000 }).catch(() => {});

    const url = page.url();
    console.error(`[me-portal] After login: ${url}`);
    if (url.includes("/Account/Login") || url.includes("/login")) {
      await page.screenshot({ path: join(downloadDir, "debug_login_failed.png") });
      throw new Error("Login failed — still on login page. Check credentials.");
    }

    this.session = { browser, page, lastActive: Date.now(), downloadDir };
    console.error("[me-portal] Login successful");
  }

  private async findInput(page: Page, names: string[]): Promise<string | null> {
    for (const name of names) {
      for (const attr of ["name", "id", "placeholder"]) {
        const sel = `input[${attr}="${name}"]`;
        if (await page.$(sel)) return sel;
      }
    }
    return null;
  }

  async downloadReport(reportKey: string, params: PortalReportParams, outputDir?: string): Promise<string> {
    if (!this.session) await this.login();
    const session = this.session!;
    const page = session.page;
    const report = PORTAL_REPORTS[reportKey];
    if (!report) throw new Error(`Unknown report: ${reportKey}. Valid: ${Object.keys(PORTAL_REPORTS).join(", ")}`);

    const targetDir = outputDir || session.downloadDir;
    mkdirSync(targetDir, { recursive: true });

    // Downloads always go to session.downloadDir (set during login via CDP).
    // After download, we move the file to targetDir if different.

    const reportUrl = `${PORTAL_REPORTS_URL}?Path=${encodeURIComponent(report.path)}`;
    console.error(`[me-portal] Loading report: ${report.name}`);
    await page.goto(reportUrl, { waitUntil: "networkidle2", timeout: 60000 });
    await new Promise((r) => setTimeout(r, 2000));

    await this.fillParams(page, report, params);

    console.error("[me-portal] Running report...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("input[type='submit'], button"));
      const b = btns.find((b) => ((b as HTMLInputElement).value || b.textContent || "").toLowerCase().includes("run report"));
      if (b) (b as HTMLElement).click();
    });

    console.error("[me-portal] Waiting for report to render (up to 5 min)...");
    await page.waitForSelector(
      'select[title*="export"], a[title*="Export"], #ReportViewer1_ctl05_ctl04_ctl00_Menu, table[id*="fixedTable"]',
      { timeout: 300000 }
    ).catch(() => console.error("[me-portal] Warning: Could not detect SSRS toolbar"));
    await new Promise((r) => setTimeout(r, 3000));

    // Export always downloads to session.downloadDir, then we move to targetDir
    const filePath = await this.exportExcel(page, report, params, session.downloadDir);
    session.lastActive = Date.now();

    // Move to target dir if different
    if (targetDir !== session.downloadDir && existsSync(filePath)) {
      const finalPath = join(targetDir, filePath.split(/[/\\]/).pop()!);
      try {
        const { copyFileSync, unlinkSync } = await import("fs");
        copyFileSync(filePath, finalPath);
        unlinkSync(filePath);
        console.error(`[me-portal] Moved to: ${finalPath}`);
        return finalPath;
      } catch { return filePath; }
    }
    return filePath;
  }

  private async fillParams(page: Page, report: PortalReportDef, params: PortalReportParams): Promise<void> {
    await this.selectOption(page, "region", "Oregon");
    await new Promise((r) => setTimeout(r, 1000));
    for (const loc of params.locations) { await this.selectOption(page, "location", loc); await new Promise((r) => setTimeout(r, 500)); }
    await new Promise((r) => setTimeout(r, 1000));
    await this.setDate(page, "BeginDate", params.beginDate);
    await this.setDate(page, "EndDate", params.endDate);
    if (report.hasCollapseFranchise && params.collapseFranchise !== undefined) {
      await page.evaluate((shouldCheck) => {
        const cbs = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        const cb = cbs.find((c) => (c.closest("div, td, tr")?.textContent || "").toLowerCase().includes("collapse franchise")) as HTMLInputElement;
        if (cb && cb.checked !== shouldCheck) cb.click();
      }, params.collapseFranchise);
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  private async selectOption(page: Page, hint: string, value: string): Promise<void> {
    await page.evaluate(({ h, v }) => {
      for (const sel of Array.from(document.querySelectorAll("select"))) {
        const ctx = (sel.closest("div, td, tr")?.textContent || "").toLowerCase();
        if (ctx.includes(h) || sel.id.toLowerCase().includes(h)) {
          for (const opt of Array.from(sel.options)) {
            if (opt.text.trim().toLowerCase().includes(v.toLowerCase())) { opt.selected = true; sel.dispatchEvent(new Event("change", { bubbles: true })); return; }
          }
        }
      }
      for (const item of Array.from(document.querySelectorAll("li, span, label, option"))) {
        if (item.textContent?.trim().toLowerCase().includes(v.toLowerCase()) && item.closest("[class*='multi'], [class*='dropdown'], select")) { (item as HTMLElement).click(); return; }
      }
    }, { h: hint, v: value });
  }

  private async setDate(page: Page, name: string, value: string): Promise<void> {
    await page.evaluate(({ n, v }) => {
      for (const inp of Array.from(document.querySelectorAll("input"))) {
        const ctx = inp.closest("div, td, tr")?.textContent || "";
        if (ctx.includes(n) || (inp.id || inp.name || "").toLowerCase().includes(n.toLowerCase())) {
          inp.value = ""; inp.focus(); inp.value = v;
          inp.dispatchEvent(new Event("input", { bubbles: true }));
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          inp.blur(); return;
        }
      }
    }, { n: name, v: value });
  }

  private async exportExcel(page: Page, report: PortalReportDef, params: PortalReportParams, targetDir: string): Promise<string> {
    // Delete any existing file with the report name so we detect the fresh download
    const expectedName = `${report.name}.xlsx`;
    const existingFile = join(targetDir, expectedName);
    if (existsSync(existingFile)) {
      const { unlinkSync } = await import("fs");
      unlinkSync(existingFile);
      console.error(`[me-portal] Removed old file: ${expectedName}`);
    }

    const filesBefore = new Set(existsSync(targetDir) ? readdirSync(targetDir) : []);
    console.error("[me-portal] Exporting to Excel...");

    // Try SSRS export dropdown → select Excel → click export
    const exported = await page.evaluate(() => {
      const sel = document.querySelector('select[title*="export" i], select[id*="ExportFormat"]') as HTMLSelectElement;
      if (sel) { for (const o of Array.from(sel.options)) { if (o.text.toLowerCase().includes("excel")) { sel.value = o.value; sel.dispatchEvent(new Event("change", { bubbles: true })); return "select"; } } }
      for (const a of Array.from(document.querySelectorAll("a, option"))) { if ((a.textContent || "").trim().toLowerCase() === "excel") { (a as HTMLElement).click(); return "link"; } }
      return "none";
    });

    if (exported === "none") {
      await page.evaluate(() => { const t = Array.from(document.querySelectorAll('[title*="Export"], [alt*="Export"]')); if (t.length) (t[0] as HTMLElement).click(); });
      await new Promise((r) => setTimeout(r, 1000));
      await page.evaluate(() => { for (const i of Array.from(document.querySelectorAll("a, div, span"))) { if ((i.textContent || "").trim() === "Excel") { (i as HTMLElement).click(); return; } } });
    }
    if (exported === "select") {
      await page.evaluate(() => { for (const b of Array.from(document.querySelectorAll('a[title*="Export"], input[value*="Export"], button'))) { const t = ((b as HTMLInputElement).value || b.textContent || "").toLowerCase(); if (t.includes("export") || (b.getAttribute("title") || "").toLowerCase().includes("export")) { (b as HTMLElement).click(); return; } } });
    }

    console.error("[me-portal] Waiting for download...");
    const filePath = await this.waitForFile(targetDir, filesBefore, 120000);
    const datePart = params.beginDate.replace(/\//g, "-");
    const locPart = params.locations.length === 1 ? params.locations[0].replace(/\s+/g, "_") : "all_clinics";
    const newPath = join(targetDir, `${report.key}_${locPart}_${datePart}.xlsx`);
    if (filePath !== newPath) {
      try { renameSync(filePath, newPath); console.error(`[me-portal] Saved: ${newPath}`); return newPath; }
      catch { console.error(`[me-portal] Saved (original name): ${filePath}`); return filePath; }
    }
    return filePath;
  }

  private async waitForFile(dir: string, before: Set<string>, timeout: number): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      await new Promise((r) => setTimeout(r, 1000));
      if (!existsSync(dir)) continue;
      const nf = readdirSync(dir).filter((f) => !before.has(f) && !f.endsWith(".crdownload") && !f.endsWith(".tmp"));
      if (nf.length) return join(dir, nf[0]);
    }
    throw new Error(`Download timed out after ${timeout / 1000}s`);
  }

  async close(): Promise<void> { if (this.session) { await this.session.browser.close().catch(() => {}); this.session = null; } }
  isLoggedIn(): boolean { return this.session !== null; }
  getSessionInfo() { return this.session ? { lastActive: this.session.lastActive, downloadDir: this.session.downloadDir } : null; }
}
