// Live-status `detail` is optional JSON the agent posts with cpu/ram/disk/charge.
// Missing keys mean the sensor isn't on this machine — render "—", never a sample value.

export function getLiveDetail(status) {
  const d = status?.detail;
  return d && typeof d === "object" && !Array.isArray(d) ? d : {};
}

export function dash(value, suffix = "") {
  if (value == null || value === "") return "—";
  return suffix ? `${value}${suffix}` : String(value);
}

export function onOff(value) {
  if (value == null) return "—";
  return value ? "On" : "Off";
}

export function liveBatteryHealthPct(status, snapshotPct) {
  const live = getLiveDetail(status).batteryHealthPct;
  return live != null ? live : snapshotPct ?? null;
}

export function liveSsdWearPct(status, snapshotPct) {
  const live = getLiveDetail(status).storageWearPct;
  return live != null ? live : snapshotPct ?? null;
}

function shortMetricLabel(raw) {
  const t = String(raw || "").trim();
  if (/^cpu/i.test(t)) return "CPU";
  if (/^ram|^memory/i.test(t)) return "RAM";
  if (/^disk/i.test(t)) return "Disk";
  if (/^battery/i.test(t)) return "Battery";
  return t.replace(/\s+usage$/i, "");
}

function compactPercent(raw) {
  const n = Number.parseFloat(raw);
  if (!Number.isFinite(n)) return raw;
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

// Same compact lines the endpoint Timeline uses — the backend still stores the full string.
export function formatEventLine(message) {
  const s = String(message || "").replace(/\s+/g, " ").trim();
  const hostId = String.raw`\S+\s+\([^)]+\)`;

  const breach = s.match(new RegExp(`^(.+?) on ${hostId} (exceeds|is below) ([\\d.]+)% - current value ([\\d.]+)%\\.?$`, "i"));
  if (breach) {
    const metric = shortMetricLabel(breach[1]);
    const over = breach[2].toLowerCase() === "exceeds" ? "over" : "below";
    return `${metric} ${compactPercent(breach[4])}% (${over} ${compactPercent(breach[3])}%)`;
  }

  const recovered = s.match(new RegExp(`^(.+?) on ${hostId} is back within the configured threshold \\(([\\d.]+)%\\) - current value ([\\d.]+)%\\.?$`, "i"));
  if (recovered) {
    return `${shortMetricLabel(recovered[1])} recovered · ${compactPercent(recovered[3])}%`;
  }

  if (new RegExp(`^Device ${hostId} is reporting again`, "i").test(s)) return "Device back online";
  if (new RegExp(`^Device ${hostId} has stopped reporting`, "i").test(s)) return "Device went offline";

  const remote = s.match(/^Remote assist requested by \S+ \((screen share|text chat|voice)/i);
  if (remote) {
    if (/text chat/i.test(remote[1])) return "Text chat requested";
    if (/voice/i.test(remote[1])) return "Voice call requested";
    return "Screen share requested";
  }
  if (/^Remote assist requested/i.test(s)) return "Screen share requested";

  if (/^LibreHardwareMonitor became available/i.test(s)) return "LHM online";
  if (/^LibreHardwareMonitor became unavailable/i.test(s)) return "LHM offline";
  if (/^rust-collector \(HWiNFO source\) became available/i.test(s)) return "HWiNFO online";
  if (/^rust-collector \(HWiNFO source\) became unavailable/i.test(s)) return "HWiNFO offline";
  if (/^Cloud Command Center became reachable/i.test(s)) return "Backend online";
  if (/^Dashboard reconnected to the local telemetry server/i.test(s)) return "Telemetry reconnected";

  return s
    .replace(/\s+on \S+ \(device_[a-f0-9]+\)/gi, "")
    .replace(/\s+\(device_[a-f0-9]+\)/gi, "")
    .replace(/\s+is back within the configured threshold\s*\(([\d.]+)%\)/i, " recovered")
    .replace(/\s+-\s+current value\s+([\d.]+)%\.?$/i, " · $1%")
    .replace(/\s+/g, " ")
    .trim();
}

const EVENT_TYPE_LABELS = {
  "alert-rule-triggered": "Alert",
  "alert-rule-cleared": "Cleared",
  "device-offline": "Offline",
  "device-online": "Online",
  "device-revoked": "Revoked",
  "hardware-tamper-detected": "Hardware change",
  "hardware-fingerprint-reset": "Fingerprint reset",
  "incident-created": "Incident",
  "incident-status-changed": "Incident update",
  "remote-assist-requested": "Remote assist",
};

export function labelEventType(type) {
  if (!type) return "Event";
  if (EVENT_TYPE_LABELS[type]) return EVENT_TYPE_LABELS[type];
  if (type.startsWith("approval-requested-")) return "Approval requested";
  if (type.startsWith("approval-approved-")) return "Approved";
  if (type.startsWith("approval-rejected-")) return "Rejected";
  return type.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
