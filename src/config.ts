export interface ReportDef {
  id: string;
  code: string;
  name: string;
  dateLogic: "payroll_period" | "per_week" | "prev_month";
  categoryFilter?: "all_sp" | "fda_only" | "esty_only" | "fda_managers" | "none";
  buildParams: (opts: ReportParamOpts) => Record<string, unknown>;
}

// Employee category GUIDs extracted from Meevo Angular UI (clinic 0014)
// These are the same across all clinics (franchise-wide category definitions)
const FDA_GUIDS = [
  "845ec091-03eb-4192-a1fe-a7040162dfbb",  // Front Desk Associate
  "9df7c93f-d6c5-4f1c-9df5-a704016301a9",  // Super Front Desk Assoc.
];
const ESTY_GUIDS = [
  "e332b9a0-2659-4336-9379-a7040162f0a2",  // Esthetician
];
const MANAGER_GUIDS = [
  "f059abe5-102b-4140-9dfe-a7040163b183",  // Manager / Assistant Manager
  "3cfc5e03-b388-4901-b301-a70401643eb8",  // Super Manager
];
const ALL_GUIDS = [
  "845ec091-03eb-4192-a1fe-a7040162dfbb",  // Front Desk Associate
  "315049d3-6ba7-4365-9031-a7be0172b04e",  // Franchise Owner
  "e332b9a0-2659-4336-9379-a7040162f0a2",  // Esthetician
  "13a5c664-da92-466f-97c8-a70401631570",  // Female Therapist
  "15617dd8-fa4d-4df9-ac6e-a70401637ba9",  // Massage Therapist
  "9df7c93f-d6c5-4f1c-9df5-a704016301a9",  // Super Front Desk Assoc.
  "56476f8c-4941-4cc3-bbef-a70401639cf3",  // Male Therapist
  "3171a733-6dfe-4daa-ac09-a7040163c497",  // Stretch Therapist
  "f059abe5-102b-4140-9dfe-a7040163b183",  // Manager / Assistant Manager
  "793df75f-8f19-4e35-88a6-a7040163e018",  // Assistant Manager
  "21892439-675b-4bc2-ab63-a7be017303c4",  // (unknown - possibly Lead Therapist)
  "3cfc5e03-b388-4901-b301-a70401643eb8",  // Super Manager
];
// All SPs = All GUIDs minus FDA GUIDs
const SP_GUIDS = ALL_GUIDS.filter(g => !FDA_GUIDS.includes(g));

// Category filter → GUID arrays for report filtering
export const CATEGORY_FILTERS: Record<string, string[]> = {
  all_sp: SP_GUIDS,
  fda_only: FDA_GUIDS,
  esty_only: ESTY_GUIDS,
  fda_managers: [...FDA_GUIDS, ...MANAGER_GUIDS],
};

export interface ReportParamOpts {
  startDate: string; // ISO date
  endDate: string;   // ISO date
  employeeGUIDs?: string[];
  categoryGUIDs?: string[];
  categoryFilter?: "all_sp" | "fda_only" | "esty_only" | "fda_managers" | "none";
  allEmployees?: boolean;
  payPeriodGUID?: string;
  payPeriodYear?: number;
}

export interface ClinicConfig {
  code: string;
  name: string;
  username: string;
  password: string;
  passkey: string;
}

export const CLINICS: Record<string, string> = {
  "0014": "Cedar Hills",
  "0355": "Keizer Station",
  "0360": "Sherwood",
  "0367": "Clackamas",
  "0661": "Mall 205",
};

// Base URL for Meevo app and report server
export const MEEVO_APP_URL = "https://me.meevo.com";
export const MEEVO_REPORT_URL = "https://merpt.meevo.com/reports/Report/LoadReport";

// Standard report format params shared across reports
function isoDate(d: string, endOfDay = false): string {
  return endOfDay
    ? `${d}T23:59:59.999Z`
    : `${d}T00:00:00.000Z`;
}

function baseParams(opts: ReportParamOpts) {
  return {
    StartDate: isoDate(opts.startDate),
    EndDate: isoDate(opts.endDate, true),
    SharedReportHeaderStartDate: isoDate(opts.startDate),
    SharedReportHeaderEndDate: isoDate(opts.endDate, true),
    clientSortOrderEnum: 2132,
  };
}

function payrollPeriodParams(opts: ReportParamOpts) {
  return {
    ...baseParams(opts),
    runForPeriods: "OnePayrollPeriod",
    PayPeriodYear: opts.payPeriodYear || new Date(opts.startDate).getFullYear(),
    PayPeriodSelected_TBL: opts.payPeriodGUID || "",
    MultiStartDate: isoDate(opts.startDate),
    MultiEndDate: isoDate(opts.endDate, true),
  };
}

export const REPORTS: Record<string, ReportDef> = {
  DE044: {
    id: "53",
    code: "DE044",
    name: "Employee Commission Detail",
    dateLogic: "payroll_period",
    categoryFilter: "all_sp",
    buildParams: (opts) => ({
      ...payrollPeriodParams(opts),
      DisplayBreakdownsDE040: false,
      IdentifyEmployeeBy: "EmployeeName",
      DisplayCommissionOverridesOnly: false,
      DisplayTips: false,
      PayPeriodEmployeeCategories_TBL: opts.categoryGUIDs || [],
      PayPeriodEmployees_TBL: opts.employeeGUIDs || [],
    }),
  },

  DE040: {
    id: "50",
    code: "DE040",
    name: "Employee Compensation Report",
    dateLogic: "payroll_period",
    // categoryFilter set dynamically: "all_sp" for DE040_SP, "fda_only" for DE040_FDA
    buildParams: (opts) => ({
      ...payrollPeriodParams(opts),
      DisplayBreakdownsDE040: false,
      RunEmployeeCompensationReportInMode: "SummaryView",
      IdentifyEmployeeBy: "EmployeeName",
      DisplayTips: true,
      PayPeriodEmployeeCategories_TBL: opts.categoryGUIDs || [],
      PayPeriodEmployees_TBL: opts.employeeGUIDs || [],
    }),
  },

  MES01: {
    id: "4",
    code: "MES01",
    name: "Employee Schedule Summary",
    dateLogic: "per_week",
    categoryFilter: "fda_only",
    buildParams: (opts) => ({
      ...baseParams(opts),
      timeZoneOffset: "-07:00:00",
      DisplayTotalsBySortOption: true,
      PageBreakAfterSortOption: true,
      EmployeeCList_TBL: opts.employeeGUIDs || [],
      EmployeeCategoryList_TBL: opts.categoryGUIDs || [],
      showInactiveEmployees: true,
      selectedPreset: { name: "LABEL_CUSTOM", status: 0 },
      OnlyDisplaySchedules: false,
      SortReportByMES01: "Employee",
      isAllEmployeeSelected: opts.allEmployees ?? false,
      dataLoaded: true,
    }),
  },

  MES10: {
    id: "33",
    code: "MES10",
    name: "Employee Time Detail",
    dateLogic: "payroll_period",
    categoryFilter: "all_sp",
    buildParams: (opts) => ({
      ...baseParams(opts),
      timeZoneOffset: "-07:00:00",
      EmployeeList_TBL: opts.employeeGUIDs || [],
      showInactiveEmployees: true,
      selectedPreset: { name: "LABEL_CUSTOM", status: 0 },
      employeePageBreak: false,
      isAllEmployeeSelected: opts.allEmployees ?? false,
      dataLoaded: true,
    }),
  },

  MA060: {
    id: "9",
    code: "MA060",
    name: "Esthetician Add-On Detail",
    dateLogic: "payroll_period",
    categoryFilter: "esty_only",
    buildParams: (opts) => ({
      ...baseParams(opts),
      timeZoneOffset: "-07:00:00",
      ServiceTimingType: "DefaultServiceTiming",
      EmployeeTimingType: "ScheduledTime",
      EmployeeCList_TBL: opts.employeeGUIDs || [],
      EmployeeCategoryList_TBL: opts.categoryGUIDs || [],
      showInactiveEmployees: true,
      selectedPreset: { name: "LABEL_CUSTOM", status: 0 },
      DisplaySummaryOnly: false,
      isAllEmployeeSelected: opts.allEmployees ?? false,
      dataLoaded: true,
    }),
  },

  AQ246: {
    id: "59",
    code: "AQ246",
    name: "Enhancement Detail",
    dateLogic: "payroll_period",
    categoryFilter: "none",
    buildParams: (opts) => ({
      ...baseParams(opts),
      timeZoneOffset: "-07:00:00",
      selectedPreset: { name: "LABEL_CUSTOM", status: 0 },
      PageBreakAfterSortOption: false,
      SortReportByAQ246: "ServicingEmployee",
    }),
  },

  MR245: {
    id: "41",
    code: "MR245",
    name: "Membership Commission",
    dateLogic: "prev_month",
    categoryFilter: "none",
    buildParams: (opts) => ({
      FieldOrderBy: "SoldBy",
      OpenCloseHistoryStartDate: isoDate(opts.startDate),
      OpenCloseHistoryEndDate: isoDate(opts.endDate, true),
      selectedPreset: { name: "LABEL_CUSTOM", status: 0 },
      OpenCloseHistoryStartTime: isoDate(opts.startDate),
      OpenCloseHistoryEndTime: isoDate(opts.endDate, true),
      SharedReportHeaderStartDate: isoDate(opts.startDate),
      SharedReportHeaderStartTime: isoDate(opts.startDate),
      SharedReportHeaderEndDate: isoDate(opts.endDate, true),
      SharedReportHeaderEndTime: isoDate(opts.endDate, true),
      clientSortOrderEnum: 2132,
    }),
  },

  MR200: {
    id: "96",
    code: "MR200",
    name: "Sales Summary",
    dateLogic: "prev_month",
    // categoryFilter set dynamically: "fda_managers" for MR200_FDA, "esty_only" for MR200_Product
    buildParams: (opts) => ({
      ...baseParams(opts),
      timeZoneOffset: "-07:00:00",
      IncludeEftPayments: true,
      EmployeeCList_TBL: opts.employeeGUIDs || [],
      EmployeeCategoryList_TBL: opts.categoryGUIDs || [],
      showInactiveEmployees: true,
      RunReportIn: "SummaryView",
      selectedPreset: { name: "LABEL_CUSTOM", status: 0 },
      DisplayTips: false,
      isAllEmployeeSelected: opts.allEmployees ?? false,
      dataLoaded: true,
    }),
  },
};

// Helper: calculate week boundaries for MES01
// Pay periods start on 1st or 16th, weeks are Mon-Sat
export function getWeekBoundaries(periodStart: string, periodEnd: string): Array<{ start: string; end: string; label: string }> {
  const start = new Date(periodStart);
  const end = new Date(periodEnd);
  const weeks: Array<{ start: string; end: string; label: string }> = [];

  let weekStart = new Date(start);
  let weekNum = 1;

  while (weekStart <= end) {
    // Find the Saturday (end of week) — day 6
    const weekEnd = new Date(weekStart);
    // Move to Saturday
    const daysToSat = (6 - weekEnd.getDay() + 7) % 7;
    weekEnd.setDate(weekEnd.getDate() + (daysToSat === 0 && weekStart.getDay() !== 6 ? 7 : daysToSat));

    // Don't go past period end
    if (weekEnd > end) {
      weekEnd.setTime(end.getTime());
    }

    weeks.push({
      start: weekStart.toISOString().split("T")[0],
      end: weekEnd.toISOString().split("T")[0],
      label: `Wk${weekNum}`,
    });

    // Next week starts on Sunday
    weekStart = new Date(weekEnd);
    weekStart.setDate(weekStart.getDate() + 1);
    weekNum++;
  }

  return weeks;
}

// Helper: get previous month date range for MR245/MR200
export function getPreviousMonthRange(periodStart: string): { start: string; end: string } {
  const d = new Date(periodStart);
  // Go to first of current month, then back one day to get last day of prev month
  const prevMonthEnd = new Date(d.getFullYear(), d.getMonth(), 0);
  const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1);
  return {
    start: prevMonthStart.toISOString().split("T")[0],
    end: prevMonthEnd.toISOString().split("T")[0],
  };
}
