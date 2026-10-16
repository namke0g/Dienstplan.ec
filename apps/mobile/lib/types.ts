export interface User { id: string; name: string; role: string; pushEnabled: boolean }
export interface ShiftType { id: string; code: string; name: string; color: string; kind: "WORK" | "VACATION" | "SPECIAL_LEAVE" | "SICK"; paid: boolean; startMin: number; endMin: number }
export interface PlanResponse {
  month: string; published: boolean; publishedAt: string | null; version: number | null; pendingChange: boolean;
  types: ShiftType[]; staff: { id: string; name: string }[];
  shifts: { userId: string; date: string; shiftTypeId: string }[];
  entries: { id: string; date: string; title: string; note: string | null }[];
  /** public holidays and ward days off in this month (missing in responses from older servers) */
  holidays?: { date: string; name: string }[];
}
export interface NotificationItem { id: string; type: string; title: string; body: string; shortNotice: boolean; createdAt: string; read: boolean }
export interface LeaveType { id: string; name: string; paid: boolean; noteRequired: boolean }
export interface LeaveItem { id: string; status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"; start: string; end: string; note: string | null; decisionComment: string | null; type: { id: string; name: string; paid: boolean } }
export interface SwapType { id: string; name: string; startMin: number; endMin: number }
export interface SwapItem {
  id: string; status: string; date: string; partnerDate: string | null; note: string | null; decisionComment: string | null;
  requester: { id: string; name: string }; partner: { id: string; name: string } | null; shiftType: SwapType | null; partnerShiftType: SwapType | null;
  problems?: string[];
}
export interface SwapBoard { mine: SwapItem[]; forMe: SwapItem[]; open: SwapItem[]; shifts: { date: string; type: SwapType }[] }
export interface SwapOptions {
  colleagues: { id: string; name: string }[];
  handOverProblems?: string[];
  theirs?: { date: string; type: SwapType; problems: string[] }[];
}
export interface Balance {
  configured: boolean; year: number;
  total?: number; remaining?: number; entitlement?: number; carryOver?: number; adjustment?: number; taken?: number; planned?: number;
  approvedHeld?: number; requested?: number; forfeited?: number; expiring?: number; carryOverExpires?: string | null; mode?: "WEEKDAYS" | "ALL_DAYS";
}
export interface SickReportItem { id: string; userId: string; name: string; start: string; end: string; note: string | null; reportedBy: string; selfReported: boolean; active: boolean }
