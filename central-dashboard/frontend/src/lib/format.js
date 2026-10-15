// Formatting + N/A rendering helpers. STRICT: metric available nathi to "Not available"
// dekhay - kahi 0 ke estimate nathi (prompt nu accuracy rule).

export function fmtNumber(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return "Not available";
  return Number(v).toLocaleString("en-US");
}

export function fmtBytes(bytes) {
  if (bytes === null || bytes === undefined || Number.isNaN(bytes)) return "Not available";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  let n = Number(bytes);
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(i === 0 ? 0 : 2)} ${units[i]}`;
}

// metric = {available, label, value, kind} ane backend mathi aavta
export function fmtMetric(metric) {
  if (!metric || metric.available === false) return "Not available";
  if (metric.kind === "bytes") return fmtBytes(metric.value);
  return fmtNumber(metric.value);
}

export function isNA(obj) {
  return !obj || obj.available === false;
}

// Parse any backend time value into an absolute Date.
// Workers Analytics Engine returns its `timestamp` as a NAIVE UTC string with no
// timezone marker (e.g. "2026-10-06 09:01:42"). new Date("2026-10-06 09:01:42")
// would interpret that as LOCAL wall-clock time and shift it (wrong by the viewer's
// offset). So any string that looks like a bare datetime (no trailing Z / no +hh:mm
// offset) is treated as UTC. Real ISO strings (with Z/offset) and epoch numbers pass
// through untouched.
function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === "number") return new Date(value);
  const s = String(value).trim();
  const naive = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}(?::\d{2})?(?:\.\d+)?)$/);
  if (naive) return new Date(`${naive[1]}T${naive[2]}Z`);
  return new Date(s);
}

// All dashboard times are shown in India Standard Time (Asia/Kolkata) so they match
// the operator's wall clock regardless of the device viewing the dashboard.
const TZ = "Asia/Kolkata";

export function fmtDate(value) {
  if (value === null || value === undefined || value === "") return "";
  const d = toDate(value);
  if (Number.isNaN(d.getTime())) return String(value);
  return d.toLocaleString("en-US", {
    timeZone: TZ,
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
