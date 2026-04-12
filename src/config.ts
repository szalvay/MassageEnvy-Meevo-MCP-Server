export interface ReportDef {
  id: string;
  code: string;
  name: string;
  dateLogic: "payroll_period" | "per_week" | "prev_month";
  categoryFilter?: "all_sp" | "fda_only" | "esty_only" | "fda_managers" | "none";
  buildParams: (opts: ReportParamOpts) => Record<string, unknown>;
}

// Category name patterns used to filter employees per report
// These are matched case-insensitively against category names from Meevo
export const CATEGORY_FILTERS: Record<string, string[]> = {
  all_sp: ["massage therapist", "female therapist", "male therapist", "stretch", "esthetician", "lead esthetician", "lead therapist"],
  fda_only: ["front desk associate", "super front desk", "front desk"],
  esty_only: ["esthetician", "lead esthetician"],
  fda_managers: ["front desk associate", "super front desk", "front desk", "manager", "business manager", "assistant manager"],
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
