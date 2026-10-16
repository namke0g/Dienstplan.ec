export interface User { id: string; name: string; role: string; pushEnabled: boolean }
export interface ShiftType { id: string; code: string; name: string; color: string; kind: "WORK" | "VACATION" | "SPECIAL_LEAVE" | "SICK"; paid: boolean; startMin: number; endMin: number }
export interface PlanResponse {
  month: string; published: boolean; publishedAt: string | null; version: number | null; pendingChange: boolean;
  types: ShiftType[]; staff: { id: string; name: string }[];
  shifts: { userId: string; date: string; shiftTypeId: string }[];
  entries: { id: string; date: string; title: string; note: string | null }[];
}
export interface NotificationItem { id: string; type: string; title: string; body: string; shortNotice: boolean; createdAt: string; read: boolean }
