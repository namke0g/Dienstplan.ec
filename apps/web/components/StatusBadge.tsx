import { STATUS_COLOR, STATUS_LABEL } from "@/lib/format";

export const StatusBadge = ({ status }: { status: string }) => (
  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_COLOR[status]}`}>{STATUS_LABEL[status]}</span>
);
