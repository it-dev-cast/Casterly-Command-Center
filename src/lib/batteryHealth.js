// Latest real batteryHealthPct from device_metric_snapshots — the same field
// prediction.js / DeviceDetail.jsx already read. Not live charge (batteryPct).
// Floor matches prediction.js BATTERY_HEALTH_THRESHOLD (80, decreasing).
const BATTERY_HEALTH_FLOOR = 80;

export function latestBatteryHealthPct(snapshots) {
  return latestSnapshotField(snapshots, "batteryHealthPct");
}

export function latestSsdWearPct(snapshots) {
  return latestSnapshotField(snapshots, "ssdWearPct");
}

function latestSnapshotField(snapshots, key) {
  if (!Array.isArray(snapshots)) return null;
  for (let i = snapshots.length - 1; i >= 0; i--) {
    if (snapshots[i][key] != null) return snapshots[i][key];
  }
  return null;
}

export function batteryHealthColor(pct) {
  if (pct == null) return "var(--text-faint)";
  if (pct <= BATTERY_HEALTH_FLOOR) return "var(--red)";
  return "var(--green)";
}

export function batteryHealthTone(pct) {
  if (pct == null) return "gray";
  if (pct <= BATTERY_HEALTH_FLOOR) return "red";
  return "green";
}

// Ceiling matches prediction.js SSD_WEAR_THRESHOLD (90, increasing).
const SSD_WEAR_CEILING = 90;

export function ssdWearTone(pct) {
  if (pct == null) return "gray";
  if (pct >= SSD_WEAR_CEILING) return "red";
  return "green";
}
