export function statusTone(status: string) {
  if (status === "completed") return "bg-emerald-50 text-emerald-700";
  if (status === "generating") return "bg-amber-50 text-amber-700";
  if (status === "failed") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export function statusLabel(status: string) {
  if (status === "completed") return "已完成";
  if (status === "generating") return "生成中";
  if (status === "failed") return "失败";
  return "待处理";
}

export function stageTone(ready: boolean) {
  return ready
    ? "bg-emerald-100 text-emerald-700"
    : "bg-slate-100 text-slate-500";
}

export function workflowBadgeTone(
  status: "idle" | "pass" | "fail" | undefined,
  stale: boolean | undefined
) {
  if (stale) return "bg-amber-50 text-amber-700";
  if (status === "pass") return "bg-emerald-50 text-emerald-700";
  if (status === "fail") return "bg-rose-50 text-rose-700";
  return "bg-slate-100 text-slate-600";
}

export function workflowBadgeLabel(
  status: "idle" | "pass" | "fail" | undefined,
  stale: boolean | undefined
) {
  if (stale) return "待刷新";
  if (status === "pass") return "预检通过";
  if (status === "fail") return "待修复";
  return "未预检";
}
