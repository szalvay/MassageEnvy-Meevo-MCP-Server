export const PORTAL_BASE_URL = "https://portal.meintranet.com";
export const PORTAL_LOGIN_URL = `${PORTAL_BASE_URL}/Account/Login`;
export const PORTAL_REPORTS_URL = `${PORTAL_BASE_URL}/WebForms/Report.aspx`;

export interface PortalReportDef {
  key: string;
  name: string;
  category: "operations" | "accounting";
  path: string;
  hasCollapseFranchise: boolean;
}

export const PORTAL_REPORTS: Record<string, PortalReportDef> = {
  scorecard: {
    key: "scorecard",
    name: "02 Scorecard Datamart 25.7",
    category: "operations",
    path: "/Meevo Operations/02 Scorecard Datamart 25.7",
    hasCollapseFranchise: false,
  },
  performance: {
    key: "performance",
    name: "01 Performance Detail Datamart 26.3",
    category: "operations",
    path: "/Meevo Operations/01 Performance Detail Datamart 26.3",
    hasCollapseFranchise: false,
  },
  franchise_settlement: {
    key: "franchise_settlement",
    name: "Franchise Settlement",
    category: "accounting",
    path: "/Meevo Accounting/Franchise Settlement",
    hasCollapseFranchise: true,
  },
  royalty_summary: {
    key: "royalty_summary",
    name: "Royalty Summary",
    category: "accounting",
    path: "/Meevo Accounting/Royalty Summary",
    hasCollapseFranchise: false,
  },
  membership_reconcile: {
    key: "membership_reconcile",
    name: "Membership Service Reconcile",
    category: "accounting",
    path: "/Meevo Accounting/Membership Service Reconcile",
    hasCollapseFranchise: false,
  },
  giftcard_reconcile: {
    key: "giftcard_reconcile",
    name: "GiftCard Reconcile",
    category: "accounting",
    path: "/Meevo Accounting/GiftCard Reconcile",
    hasCollapseFranchise: false,
  },
  royalty_rebate: {
    key: "royalty_rebate",
    name: "Royalty Rebate Reconcile",
    category: "accounting",
    path: "/Meevo Accounting/Royalty Rebate Reconcile",
    hasCollapseFranchise: false,
  },
};

export const PORTAL_CLINICS: Record<string, string> = {
  "0014": "Cedar Hills",
  "0355": "Keizer Station",
  "0360": "Sherwood",
  "0367": "Clackamas",
  "0661": "Mall 205",
};

export const ALL_PORTAL_LOCATIONS = Object.values(PORTAL_CLINICS);
