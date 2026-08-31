import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Lock, Cpu, MemoryStick, HardDrive, BatteryMedium, BatteryCharging, Disc, TrendingDown, TrendingUp,
  Search, ShieldCheck, ShieldAlert, AlertTriangle, Info, Thermometer, Gpu, Shield,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useLiveData, healthFromLiveStatus, CPU_USAGE_THRESHOLDS, RAM_USAGE_THRESHOLDS, DISK_USAGE_THRESHOLDS } from "../context/LiveDataContext.jsx";
import { useDialog } from "../context/DialogContext.jsx";
import { api } from "../lib/api.js";
import { predictDeviceHealth } from "../lib/prediction.js";
import { latestBatteryHealthPct, latestSsdWearPct, batteryHealthTone, ssdWearTone } from "../lib/batteryHealth.js";
import { getLiveDetail, dash, onOff, liveBatteryHealthPct, liveSsdWearPct, formatEventLine } from "../lib/liveDetail.js";
import { parseHardwareChanges } from "../lib/hardwareEvents.js";
import { computeOfflineDeviceIds } from "../lib/deviceLiveness.js";
import TagEditor from "../components/TagEditor.jsx";
import StatCard from "../components/StatCard.jsx";
import ChainIntegrityCard from "../components/ChainIntegrityCard.jsx";
import ApprovalsTable from "../components/ApprovalsTable.jsx";
import EventDetailPanel from "../components/EventDetailPanel.jsx";
import { STATUS_LABELS, STATUS_TONE, OPEN_STATUSES } from "./Incidents.jsx";

// Real tone names (not CSS color strings) for the same thresholds getUsageColor/getBatteryColor
// already use - so the KPI tile itself carries the real severity signal (a critical CPU reading
// gets a red tile, not just red text in a neutral tile), consistent with how every other tiled
// page's color means something rather than being decorative branding.
function usageTone(percent, thresholds) {
  if (percent == null) return "gray";
  if (percent > thresholds.critical) return "red";
  if (percent > thresholds.warning) return "amber";
  return "green";
}
function batteryTone(percent) {
  if (percent == null) return "gray";
  if (percent > 50) return "green";
  if (percent >= 20) return "amber";
  return "red";
}
const RISK_TONE = { Low: "green", Medium: "amber", High: "red" };

// Real, derived "what's actually wrong right now" list for the header/Overview - reuses the same
// threshold helpers above and the same thresholds every StatCard on this page already colors by,
// rather than a second independently-invented severity judgment. Returns [] (nothing to show) when
// there's no live reading yet or every metric is within its normal range - never a fabricated
// "all clear" claim when the real answer is "no data."
function currentIssues(liveStatus) {
  if (!liveStatus) return [];
  const issues = [];
  const detail = getLiveDetail(liveStatus);
  if (liveStatus.cpuPct != null && usageTone(liveStatus.cpuPct, CPU_USAGE_THRESHOLDS) !== "green") issues.push(`CPU ${liveStatus.cpuPct}%`);
  if (liveStatus.ramPct != null && usageTone(liveStatus.ramPct, RAM_USAGE_THRESHOLDS) !== "green") issues.push(`RAM ${liveStatus.ramPct}%`);
  if (liveStatus.diskPct != null && usageTone(liveStatus.diskPct, DISK_USAGE_THRESHOLDS) !== "green") issues.push(`Disk ${liveStatus.diskPct}%`);
  if (liveStatus.batteryPct != null && batteryTone(liveStatus.batteryPct) !== "green") issues.push(`Charge ${liveStatus.batteryPct}%`);
  if (detail.batteryHealthPct != null && detail.batteryHealthPct <= 80) issues.push(`Battery health ${detail.batteryHealthPct}%`);
  if (detail.cpuTempC != null && detail.cpuTempC >= 85) issues.push(`CPU ${Math.round(detail.cpuTempC)}°C`);
  return issues;
}

function Kv({ label, value }) {
  const empty = value == null || value === "—";
  return (
    <div className="kv-row">
      <span className="section-sub">{label}</span>
      <span className={`kv-val${empty ? " empty" : ""}`}>{empty ? "—" : value}</span>
    </div>
  );
}

function fmtTime(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}
function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const TABS = [
  { key: "overview", label: "Overview" },
  { key: "telemetry", label: "Live Telemetry" },
  { key: "hardware", label: "Hardware" },
  { key: "events", label: "Events" },
  { key: "alerts", label: "Alerts" },
  { key: "incidents", label: "Incidents" },
  { key: "lifecycle", label: "Lifecycle" },
  { key: "approvals", label: "Approvals" },
  { key: "activity", label: "Activity" },
];

export default function DeviceDetail() {
  const { id } = useParams();
  const { token, devices, liveStatusByDevice, events, connected, revokeDevice, resetFingerprint, pushToast } = useLiveData();
  const { confirmAsync } = useDialog();
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsError, setSnapshotsError] = useState(null);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [incidents, setIncidents] = useState([]);
  const [incidentsError, setIncidentsError] = useState(null);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [approvals, setApprovals] = useState([]);
  const [approvalsError, setApprovalsError] = useState(null);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [busyRequestId, setBusyRequestId] = useState(null);
  const [tab, setTab] = useState("overview");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [eventSeverityFilter, setEventSeverityFilter] = useState("all");
  const [eventSearch, setEventSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);

  const device = devices.find((d) => d.id === id);
  const liveStatus = liveStatusByDevice[id];
  const detail = getLiveDetail(liveStatus);
  const health = healthFromLiveStatus(liveStatus);
  // Real liveness (device-offline/-online events), distinct from `connected` (this browser tab's
  // SSE pipe) - reused from deviceLiveness.js rather than re-derived, same signal Dashboard/Action
  // Center already show. A device can be genuinely offline while this tab's SSE connection is
  // still fine, so "LIVE" telemetry shouldn't claim currency it doesn't have in that case.
  const deviceIsOffline = computeOfflineDeviceIds(events, liveStatusByDevice).has(id);
  const issues = currentIssues(liveStatus);
  const deviceEvents = events.filter((e) => e.deviceId === id);
  const deviceAlerts = deviceEvents.filter((e) => e.severity !== "info");
  const deviceActivity = deviceEvents.filter((e) => e.severity === "info");
  const hardwareChangeEvents = deviceEvents.filter((e) => e.eventType === "hardware-tamper-detected");
  const hardwareResetEvents = deviceEvents.filter((e) => e.eventType === "hardware-fingerprint-reset");
  const hardwareChangeCount = hardwareChangeEvents.reduce((n, e) => n + parseHardwareChanges(e.message).length, 0);
  const eventTypes = [...new Set(deviceEvents.map((e) => e.eventType))].sort();
  const q = eventSearch.trim().toLowerCase();
  const filteredTimelineEvents = deviceEvents.filter((e) => {
    if (eventTypeFilter !== "all" && e.eventType !== eventTypeFilter) return false;
    if (eventSeverityFilter !== "all" && e.severity !== eventSeverityFilter) return false;
    if (q && !e.message.toLowerCase().includes(q) && !e.eventType.toLowerCase().includes(q)) return false;
    return true;
  });
  // Real Event -> Incident link: backend/incidents.go's real sourceEventId field, already
  // returned on every incident, just never read back for navigation until now.
  function relatedIncidentFor(event) {
    return incidents.find((i) => i.sourceEventId === event.id) || null;
  }

  useEffect(() => {
    if (!token || !id) return;
    setSnapshotsError(null);
    setSnapshotsLoading(true);
    api.getDeviceMetricSnapshots(token, id).then(setSnapshots).catch((e) => { setSnapshots([]); setSnapshotsError(e.message); }).finally(() => setSnapshotsLoading(false));
    setIncidentsError(null);
    setIncidentsLoading(true);
    api.listIncidents(token).then((list) => setIncidents(list.filter((i) => i.deviceId === id))).catch((e) => setIncidentsError(e.message)).finally(() => setIncidentsLoading(false));
    refreshApprovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);

  async function refreshApprovals() {
    setApprovalsError(null);
    setApprovalsLoading(true);
    const list = await api.listApprovalRequests(token).catch((e) => { setApprovalsError(e.message); return []; });
    setApprovals(list.filter((a) => a.deviceId === id));
    setApprovalsLoading(false);
  }

  async function handleApproveRequest(reqId) {
    setBusyRequestId(reqId);
    try {
      await api.approveRequest(token, reqId);
      await refreshApprovals();
      pushToast("success", "Request approved", "The approval queue has been updated.");
    } catch (e) {
      pushToast("error", "Approval failed", e.message);
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleRejectRequest(reqId) {
    setBusyRequestId(reqId);
    try {
      await api.rejectRequest(token, reqId);
      await refreshApprovals();
      pushToast("success", "Request rejected", "The approval queue has been updated.");
    } catch (e) {
      pushToast("error", "Rejection failed", e.message);
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleRevoke() {
    const ok = await confirmAsync(`Revoke ${id}? Its API key will be rejected immediately.`, "Revoke");
    if (!ok) return;
    setBusy(true);
    try {
      await revokeDevice(id);
      pushToast("success", "Device revoked", `${id}'s API key is now rejected immediately.`);
    } catch (e) {
      pushToast("error", "Revoke failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleResetFingerprint() {
    const ok = await confirmAsync(`Reset hardware fingerprint baseline for ${id}? Use this after a legitimate hardware upgrade.`, "Reset");
    if (!ok) return;
    setBusy(true);
    try {
      await resetFingerprint(id);
      pushToast("success", "Fingerprint reset", "Baseline cleared — next hardware-check will capture a fresh one.");
    } catch (e) {
      pushToast("error", "Reset failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  if (!device) {
    return (
      <div>
        <Link to="/endpoints" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-faint)", fontSize: 13, marginBottom: 16 }}>
          <ArrowLeft size={14} /> Back to Endpoints
        </Link>
        <div className="card"><div className="empty-note">Device not found (it may not have loaded yet, or the ID is wrong).</div></div>
      </div>
    );
  }

  const chartData = snapshots.map((s) => ({
    date: new Date(s.recordedAt).toLocaleDateString(),
    "Battery Health %": s.batteryHealthPct,
    "SSD Wear %": s.ssdWearPct,
  }));
  const prediction = predictDeviceHealth(snapshots);
  const batteryHealthPct = liveBatteryHealthPct(liveStatus, latestBatteryHealthPct(snapshots));
  const ssdWearPct = liveSsdWearPct(liveStatus, latestSsdWearPct(snapshots));
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const identityLine = [detail.manufacturer, detail.model].filter(Boolean).join(" · ") || "Identity not reported yet";
  const liveDot = !!liveStatus && connected && !deviceIsOffline;

  return (
    <div>
      <Link to="/endpoints" style={{ display: "inline-flex", alignItems: "center", gap: 6, color: "var(--text-faint)", fontSize: 13, marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Endpoints
      </Link>

      <div className="device-hero">
        <div>
          <h1 className="device-hero-title">{device.hostname}</h1>
          <p className="device-hero-sub">{identityLine}</p>
          <p className="page-sub mono" style={{ marginTop: 4 }}>{device.id}{detail.serial ? ` · ${detail.serial}` : ""}</p>
        </div>
        <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
          <button className="btn" onClick={handleResetFingerprint} disabled={busy}>Reset FP</button>
          {device.status === "active" && <button className="btn danger" onClick={handleRevoke} disabled={busy}>Revoke</button>}
        </div>
      </div>

      {/* Real device liveness (deviceIsOffline) takes priority over the tab-wide SSE flag
          (connected) when they disagree - a device can genuinely be offline while this browser
          tab's own connection is fine, and that's the more honest thing to show here. */}
      <div className="card device-status-strip">
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="section-sub">Status</span>
          <span className={`badge ${device.status === "active" ? "green" : "slate"}`}>{device.status}</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="section-sub">Health</span>
          <span className={`badge ${health === "healthy" ? "green" : health === "warning" ? "amber" : health === "critical" ? "red" : "gray"}`}>
            {health === "unknown" ? "no data" : health}
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13, fontWeight: 600, color: deviceIsOffline ? "var(--text-faint)" : connected ? "var(--green)" : "var(--amber)" }}>
          <span style={{ width: 7, height: 7, borderRadius: 999, background: deviceIsOffline ? "var(--text-faint)" : connected ? "var(--green)" : "var(--amber)", display: "inline-block" }} />
          {deviceIsOffline ? "Offline" : connected ? "Live" : "Reconnecting"}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
          <span className="section-sub">Last Seen</span>
          <span style={{ fontSize: 13 }}>{timeAgo(device.lastSeenAt)}</span>
        </div>
        {issues.length > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: "auto" }}>
            <AlertTriangle size={14} color="var(--amber)" />
            <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--amber)" }}>{issues.join(" · ")}</span>
          </div>
        )}
      </div>

      <div className="tab-row">
        {TABS.map((t) => (
          <div key={t.key} className={`tab-item ${tab === t.key ? "active" : ""}`} onClick={() => setTab(t.key)}>
            {t.label}
            {t.key === "events" && deviceEvents.length > 0 && <span className="badge" style={{ marginLeft: 7, padding: "0 6px" }}>{deviceEvents.length}</span>}
            {t.key === "alerts" && deviceAlerts.length > 0 && <span className="badge amber" style={{ marginLeft: 7, padding: "0 6px" }}>{deviceAlerts.length}</span>}
            {t.key === "incidents" && !incidentsLoading && incidents.length > 0 && <span className="badge" style={{ marginLeft: 7, padding: "0 6px" }}>{incidents.length}</span>}
            {t.key === "approvals" && pendingApprovals.length > 0 && <span className="badge amber" style={{ marginLeft: 7, padding: "0 6px" }}>{pendingApprovals.length}</span>}
            {t.key === "activity" && deviceActivity.length > 0 && <span className="badge" style={{ marginLeft: 7, padding: "0 6px" }}>{deviceActivity.length}</span>}
          </div>
        ))}
      </div>

      {tab === "overview" && (
        <>
          <div className="grid grid-2" style={{ gap: 20, marginBottom: 20 }}>
            <div className="card">
              <h3 className="section-title">Identity</h3>
              <div className="kv-list" style={{ marginTop: 4 }}>
                <Kv label="Manufacturer" value={dash(detail.manufacturer)} />
                <Kv label="Model" value={dash(detail.model)} />
                <Kv label="Serial" value={dash(detail.serial)} />
                <Kv label="OS" value={dash(detail.osCaption)} />
                <Kv label="Enrolled" value={fmtTime(device.enrolledAt)} />
                <Kv label="Hardware Baseline" value={device.fingerprintLockedAt ? "Locked" : "Pending"} />
              </div>
            </div>
            <div className="card">
              <h3 className="section-title">Security</h3>
              <div className="kv-list" style={{ marginTop: 4 }}>
                <Kv label="Score" value={dash(detail.securityHealthPct, "%")} />
                <Kv label="TPM" value={onOff(detail.tpmActive)} />
                <Kv label="Secure Boot" value={onOff(detail.secureBootEnabled)} />
                <Kv label="BitLocker" value={onOff(detail.bitlockerOn)} />
              </div>
              <p className="section-sub" style={{ marginTop: 10 }}>Same three signals as the agent title-bar — missing sensors stay —</p>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title">Tags</h3>
            <p className="section-sub">Real device grouping — organize by department, location, customer, etc.</p>
            <TagEditor deviceId={device.id} tags={device.tags || []} />
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title">Live snapshot</h3>
            <p className="section-sub" style={{ marginBottom: 12 }}>Same numbers the agent shows. Charge is not battery health. Missing sensors are —.</p>
            {liveStatus ? (
              <div className="grid grid-3">
                <StatCard icon={Cpu} tone={usageTone(liveStatus.cpuPct, CPU_USAGE_THRESHOLDS)} value={dash(liveStatus.cpuPct, "%")} label="CPU" meta={detail.cpuName} live={liveDot} />
                <StatCard icon={MemoryStick} tone={usageTone(liveStatus.ramPct, RAM_USAGE_THRESHOLDS)} value={dash(liveStatus.ramPct, "%")} label="RAM" meta={detail.memTotalGB != null ? `${detail.memTotalGB} GB` : null} live={liveDot} />
                <StatCard icon={HardDrive} tone={usageTone(liveStatus.diskPct, DISK_USAGE_THRESHOLDS)} value={dash(liveStatus.diskPct, "%")} label="Disk" meta={detail.driveModel} live={liveDot} />
                <StatCard icon={BatteryCharging} tone={batteryTone(liveStatus.batteryPct)} value={dash(liveStatus.batteryPct, "%")} label="Charge" live={liveDot} />
                <StatCard icon={BatteryMedium} tone={batteryHealthTone(batteryHealthPct)} value={dash(batteryHealthPct, "%")} label="Battery Health" live={liveDot && detail.batteryHealthPct != null} />
                <StatCard icon={Shield} tone={detail.securityHealthPct == null ? "gray" : detail.securityHealthPct === 100 ? "green" : "amber"} value={dash(detail.securityHealthPct, "%")} label="Security" live={liveDot && detail.securityHealthPct != null} />
              </div>
            ) : (
              <div className="empty-note">No live telemetry received from this device yet.</div>
            )}
          </div>

          <div className="grid grid-2" style={{ gap: 20, marginBottom: 20 }}>
            <div className="card">
              <div className="section-head">
                <h3 className="section-title">Recent Events</h3>
                <span className="btn" style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setTab("events")}>View all</span>
              </div>
              {deviceEvents.slice(0, 5).map((e) => (
                <div key={e.id} onClick={() => setSelectedEvent(e)} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5, cursor: "pointer" }}>
                  <span className="truncate" style={{ maxWidth: 220 }} title={e.message}>{formatEventLine(e.message)}</span>
                  <span className="mono" style={{ color: "var(--text-faint)", flexShrink: 0 }}>{timeAgo(e.createdAt)}</span>
                </div>
              ))}
              {deviceEvents.length === 0 && <div className="empty-note">No events yet.</div>}
            </div>
            <div className="card">
              <div className="section-head">
                <h3 className="section-title">Incident / Alert Context</h3>
                <span className="btn" style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setTab("alerts")}>View all</span>
              </div>
              {!incidentsLoading && !incidentsError && (
                <p className="section-sub" style={{ marginBottom: 8 }}>
                  {(() => {
                    const openCount = incidents.filter((i) => OPEN_STATUSES.includes(i.status)).length;
                    return openCount > 0
                      ? <span onClick={() => setTab("incidents")} style={{ cursor: "pointer", color: "var(--red)", fontWeight: 600 }}>{openCount} open incident{openCount !== 1 ? "s" : ""} for this device →</span>
                      : "No open incidents for this device.";
                  })()}
                </p>
              )}
              {deviceAlerts.slice(0, 5).map((e) => (
                <div key={e.id} onClick={() => setSelectedEvent(e)} style={{ display: "flex", justifyContent: "space-between", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--border-soft)", fontSize: 12.5, cursor: "pointer" }}>
                  <span className="truncate" style={{ maxWidth: 220 }} title={e.message}><span className={`badge ${e.severity === "critical" ? "red" : "amber"}`} style={{ marginRight: 6 }}>{e.severity}</span>{formatEventLine(e.message)}</span>
                  <span className="mono" style={{ color: "var(--text-faint)", flexShrink: 0 }}>{timeAgo(e.createdAt)}</span>
                </div>
              ))}
              {deviceAlerts.length === 0 && <div className="empty-note">No alerts — this device is quiet.</div>}
            </div>
          </div>

          {/* AI / PREDICTION - reuses the exact same `prediction` object the Lifecycle tab computes
              from predictDeviceHealth(snapshots) below; no second calculation, no confidence value,
              no fabricated root cause - just a condensed view of the same real statuses. */}
          <div className="card">
            <div className="section-head">
              <h3 className="section-title">AI Prediction</h3>
              <span className="btn" style={{ fontSize: 11, cursor: "pointer" }} onClick={() => setTab("lifecycle")}>View trend</span>
            </div>
            <div className="grid grid-2" style={{ gap: 16, marginTop: 4 }}>
              {[
                { label: "Battery Health", p: prediction.battery },
                { label: "SSD Wear", p: prediction.ssd },
              ].map(({ label, p }) => (
                <div key={label} style={{ fontSize: 13 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>{label}</div>
                  {p.status === "ok" && <span className={`badge ${RISK_TONE[p.risk]}`}>{p.daysRemaining}d remaining — {p.risk} risk</span>}
                  {p.status === "insufficient-data" && <span style={{ color: "var(--text-faint)" }}>Insufficient data — {p.daysOfHistory} of {p.minRequired} days recorded</span>}
                  {p.status === "already-past-threshold" && <span style={{ color: "var(--red)" }}>Already past the real degradation threshold</span>}
                  {p.status === "stable" && <span style={{ color: "var(--text-faint)" }}>Trend is flat/improving — no degradation projected</span>}
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {tab === "telemetry" && (
        <div className="card">
          <div className="section-head">
            <div>
              <h3 className="section-title">Live Telemetry</h3>
              <p className="section-sub">CPU, RAM, Disk, and charge update ~every 5s with identity, health, security, and temps from the same poll. Missing sensors are —.</p>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: deviceIsOffline ? "var(--text-faint)" : connected ? "var(--green)" : "var(--amber)" }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: deviceIsOffline ? "var(--text-faint)" : connected ? "var(--green)" : "var(--amber)", display: "inline-block" }} />
              {deviceIsOffline ? "OFFLINE" : connected ? "LIVE" : "RECONNECTING"} · updated {liveStatus?.updatedAt ? timeAgo(liveStatus.updatedAt) : "never"}
            </div>
          </div>
          {/* live={} only claims currency when this device is both actively connected AND not
              known-offline (real device-offline/-online events, not just this tab's SSE state) -
              a device that went offline 10 minutes ago shouldn't still show a pulsing "Live" dot
              just because its last reported values happen to still be in memory. */}
          <div className="grid grid-3">
            <StatCard icon={Cpu} tone={usageTone(liveStatus?.cpuPct, CPU_USAGE_THRESHOLDS)} value={dash(liveStatus?.cpuPct, "%")} label="CPU" meta={detail.cpuName} live={liveDot} />
            <StatCard icon={MemoryStick} tone={usageTone(liveStatus?.ramPct, RAM_USAGE_THRESHOLDS)} value={dash(liveStatus?.ramPct, "%")} label="RAM" meta={detail.memTotalGB != null ? `${detail.memTotalGB} GB` : null} live={liveDot} />
            <StatCard icon={HardDrive} tone={usageTone(liveStatus?.diskPct, DISK_USAGE_THRESHOLDS)} value={dash(liveStatus?.diskPct, "%")} label="Disk" meta={detail.diskFreeGB != null ? `${detail.diskFreeGB} GB free` : null} live={liveDot} />
            <StatCard icon={BatteryCharging} tone={batteryTone(liveStatus?.batteryPct)} value={dash(liveStatus?.batteryPct, "%")} label="Charge" live={liveDot} />
            <StatCard icon={BatteryMedium} tone={batteryHealthTone(batteryHealthPct)} value={dash(batteryHealthPct, "%")} label="Battery Health" live={liveDot && detail.batteryHealthPct != null} />
            <StatCard icon={Disc} tone={ssdWearTone(ssdWearPct)} value={dash(ssdWearPct, "%")} label="SSD Wear" live={liveDot && detail.storageWearPct != null} />
            <StatCard icon={Thermometer} tone={detail.cpuTempC == null ? "gray" : detail.cpuTempC >= 85 ? "red" : "teal"} value={detail.cpuTempC != null ? `${Math.round(detail.cpuTempC)}°C` : "—"} label="CPU Temp" live={liveDot && detail.cpuTempC != null} />
            <StatCard icon={Gpu} tone={detail.gpuUtilPct == null ? "gray" : "purple"} value={dash(detail.gpuUtilPct, "%")} label="GPU" meta={detail.gpuName} live={liveDot && detail.gpuUtilPct != null} />
            <StatCard icon={Thermometer} tone={detail.gpuTempC == null ? "gray" : "purple"} value={detail.gpuTempC != null ? `${Math.round(detail.gpuTempC)}°C` : "—"} label="GPU Temp" live={liveDot && detail.gpuTempC != null} />
            <StatCard icon={Shield} tone={detail.securityHealthPct == null ? "gray" : detail.securityHealthPct === 100 ? "green" : "amber"} value={dash(detail.securityHealthPct, "%")} label="Security" live={liveDot && detail.securityHealthPct != null} />
          </div>
          {!liveStatus && <div className="empty-note" style={{ marginTop: 12 }}>No live telemetry received from this device yet.</div>}
          {liveStatus && deviceIsOffline && <div className="empty-note" style={{ marginTop: 12, color: "var(--amber)" }}>This device is currently offline — the values above are its last reported readings, not current.</div>}
        </div>
      )}

      {tab === "hardware" && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title">Hardware inventory</h3>
            <p className="section-sub" style={{ marginBottom: 8 }}>Live from this endpoint's last telemetry poll — same sources as the agent Hardware page. Unknown stays —.</p>
            <div className="grid grid-2" style={{ gap: 8 }}>
              <div className="kv-list">
                <Kv label="CPU" value={dash(detail.cpuName)} />
                <Kv label="CPU temp" value={detail.cpuTempC != null ? `${Math.round(detail.cpuTempC)}°C` : "—"} />
                <Kv label="Memory" value={detail.memTotalGB != null ? `${detail.memTotalGB} GB` : "—"} />
                <Kv label="Disk" value={dash(detail.driveModel)} />
                <Kv label="SSD wear" value={dash(ssdWearPct, "%")} />
              </div>
              <div className="kv-list">
                <Kv label="GPU" value={dash(detail.gpuName)} />
                <Kv label="GPU util" value={dash(detail.gpuUtilPct, "%")} />
                <Kv label="GPU temp" value={detail.gpuTempC != null ? `${Math.round(detail.gpuTempC)}°C` : "—"} />
                <Kv label="Battery health" value={dash(batteryHealthPct, "%")} />
                <Kv label="Charge" value={dash(liveStatus?.batteryPct, "%")} />
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              {hardwareChangeCount === 0
                ? <ShieldCheck size={22} color="var(--green)" />
                : <ShieldAlert size={22} color="var(--amber)" />}
              <div>
                <div style={{ fontWeight: 700, color: hardwareChangeCount === 0 ? "var(--green)" : "var(--amber)" }}>
                  {hardwareChangeCount === 0 ? "NORMAL" : "CHANGE DETECTED"}
                </div>
                <div className="section-sub">
                  {hardwareChangeCount === 0
                    ? "All observed hardware matches baseline."
                    : `${hardwareChangeCount} hardware change${hardwareChangeCount !== 1 ? "s" : ""} detected across ${hardwareChangeEvents.length} check${hardwareChangeEvents.length !== 1 ? "s" : ""}.`}
                </div>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-head" style={{ marginBottom: 0 }}>
              <h3 className="section-title">Hardware Overview</h3>
              <Info
                size={13} color="var(--text-faint)" style={{ cursor: "help", marginTop: 3 }}
                title="The fingerprint binds this device's API key to its detected hardware signature. Resetting clears the stored baseline so the next hardware-check cycle captures a fresh one — use after a legitimate hardware upgrade (drive swap, motherboard replacement) so the device isn't flagged as a mismatch. This backend doesn't expose a per-component hardware inventory (CPU/RAM/GPU model, capacity, etc.) for fields that have never mismatched — only fields involved in a real detected change are ever known here, shown below."
              />
            </div>
            <p className="section-sub" style={{ marginTop: 6 }}>
              {device.fingerprintLockedAt
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Lock size={13} /> Baseline locked at {fmtTime(device.fingerprintLockedAt)}</span>
                : "Baseline not yet locked — captures on next check."}
            </p>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title" style={{ marginBottom: 4 }}>Detected Hardware Changes</h3>
            <p className="section-sub">Real, parsed from this device's own hardware-tamper-detected events — click a row to open the underlying event</p>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Component</th><th>Baseline</th><th>Current</th><th>Status</th><th>Source</th><th>Detected At</th></tr></thead>
                <tbody>
                  {hardwareChangeEvents.flatMap((e) =>
                    parseHardwareChanges(e.message).map((c, i) => (
                      <tr key={`${e.id}-${i}`} onClick={() => setSelectedEvent(e)} style={{ cursor: "pointer" }}>
                        <td style={{ fontWeight: 600 }}>{c.field}</td>
                        <td className="mono truncate" style={{ maxWidth: 180 }} title={c.baseline}>{c.baseline || "—"}</td>
                        <td className="mono truncate" style={{ maxWidth: 180 }} title={c.current}>{c.current || "—"}</td>
                        <td><span className="badge red">CHANGED</span></td>
                        <td style={{ fontSize: 12, color: "var(--text-faint)" }}>Endpoint Agent</td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                      </tr>
                    ))
                  )}
                  {hardwareChangeEvents.length === 0 && <tr><td colSpan={6} className="empty-note">No hardware changes detected for this device.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 className="section-title" style={{ marginBottom: 4 }}>Baseline Resets</h3>
            <p className="section-sub">Real hardware-fingerprint-reset events — logged whenever an operator clears this device's baseline</p>
            {hardwareResetEvents.length === 0 ? (
              <div className="empty-note">No baseline resets recorded for this device.</div>
            ) : (
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Message</th><th>When</th></tr></thead>
                  <tbody>
                    {hardwareResetEvents.map((e) => (
                      <tr key={e.id} onClick={() => setSelectedEvent(e)} style={{ cursor: "pointer" }}>
                        <td className="truncate" style={{ maxWidth: 400 }} title={e.message}>{formatEventLine(e.message)}</td>
                        <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {tab === "events" && (
        <>
          <div style={{ marginBottom: 20 }}>
            <ChainIntegrityCard />
            <p style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Chain verification is tenant-wide — it isn't scoped to only this device's events.</p>
          </div>

          <div className="card">
            <div className="section-head">
              <div>
                <h3 className="section-title">Event Timeline</h3>
                <p className="section-sub">This device's events within the current event window (most recent first, up to 200 tenant-wide) — click a row for details</p>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
              <div className="search-box" style={{ maxWidth: 240 }}>
                <Search size={14} />
                <input
                  value={eventSearch}
                  onChange={(e) => setEventSearch(e.target.value)}
                  placeholder="Search type or message..."
                  style={{ background: "transparent", border: "none", outline: "none", color: "inherit", font: "inherit", width: "100%" }}
                />
              </div>
              <select className="pill-select" value={eventSeverityFilter} onChange={(e) => setEventSeverityFilter(e.target.value)}>
                <option value="all">All severities</option>
                <option value="critical">Critical</option>
                <option value="warning">Warning</option>
                <option value="info">Info</option>
              </select>
              <select className="pill-select" value={eventTypeFilter} onChange={(e) => setEventTypeFilter(e.target.value)}>
                <option value="all">All types</option>
                {eventTypes.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Severity</th><th>Type</th><th>Message</th><th>When</th></tr></thead>
                <tbody>
                  {filteredTimelineEvents.slice(0, 50).map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setSelectedEvent(e)}
                      style={{ cursor: "pointer", boxShadow: e.severity === "critical" ? "inset 3px 0 0 0 var(--red)" : e.severity === "warning" ? "inset 3px 0 0 0 var(--amber)" : "none" }}
                    >
                      <td><span className={`badge ${e.severity === "critical" ? "red" : e.severity === "warning" ? "amber" : "blue"}`}>{e.severity}</span></td>
                      <td>{e.eventType}</td>
                      <td className="truncate" style={{ maxWidth: 360 }} title={e.message}>{formatEventLine(e.message)}</td>
                      <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                    </tr>
                  ))}
                  {deviceEvents.length === 0 && <tr><td colSpan={4} className="empty-note">No events recorded for this device.</td></tr>}
                  {deviceEvents.length > 0 && filteredTimelineEvents.length === 0 && <tr><td colSpan={4} className="empty-note">No events match these filters.</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {tab === "alerts" && (
        <div className="card">
          <h3 className="section-title">Alerts</h3>
          <p className="section-sub">Warning and critical severity events for this device — click a row for details</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Severity</th><th>Type</th><th>Message</th><th>When</th></tr></thead>
              <tbody>
                {deviceAlerts.slice(0, 50).map((e) => (
                  <tr key={e.id} onClick={() => setSelectedEvent(e)} style={{ cursor: "pointer" }}>
                    <td><span className={`badge ${e.severity === "critical" ? "red" : "amber"}`}>{e.severity}</span></td>
                    <td>{e.eventType}</td>
                    <td className="truncate" style={{ maxWidth: 360 }} title={e.message}>{formatEventLine(e.message)}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                  </tr>
                ))}
                {deviceAlerts.length === 0 && <tr><td colSpan={4} className="empty-note">No alerts for this device — it's quiet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "incidents" && (
        <div className="card">
          <h3 className="section-title">Incidents for this device</h3>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Opened</th></tr></thead>
              <tbody>
                {!incidentsLoading && incidents.map((i) => (
                  <tr key={i.id}>
                    <td className="truncate" style={{ maxWidth: 320 }} title={i.title}><Link to={`/incidents/${i.id}`} style={{ color: "var(--accent)" }}>{i.title}</Link></td>
                    <td><span className={`badge ${i.severity === "critical" ? "red" : i.severity === "warning" ? "amber" : "blue"}`}>{i.severity}</span></td>
                    <td><span className={`badge ${STATUS_TONE[i.status]}`}>{STATUS_LABELS[i.status] ?? i.status}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(i.createdAt)}</td>
                  </tr>
                ))}
                {incidentsLoading && <tr><td colSpan={4} className="empty-note">Loading incidents…</td></tr>}
                {!incidentsLoading && incidentsError && <tr><td colSpan={4} className="empty-note" style={{ color: "var(--red)" }}>Couldn't load incidents: {incidentsError}</td></tr>}
                {!incidentsLoading && !incidentsError && incidents.length === 0 && <tr><td colSpan={4} className="empty-note">No incidents for this device.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === "lifecycle" && (
        <>
          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title">AI Device Intelligence</h3>
            <p className="section-sub">
              Real battery/SSD wear prediction from this device's own history{" "}
              <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Same closed-form regression ai-service computes, run here over the same real snapshots. Not a forecast until at least 3 days of history exist." />
            </p>
            <div className="grid grid-2" style={{ gap: 20, marginTop: 12 }}>
              {[
                { label: "Battery Health", icon: TrendingDown, p: prediction.battery, unit: "Battery Health" },
                { label: "SSD", icon: TrendingUp, p: prediction.ssd, unit: "SSD Wear" },
              ].map(({ label, icon: Icon, p, unit }) => (
                <div key={label} className="card" style={{ background: "var(--bg-panel-2)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                    <Icon size={16} color="var(--accent)" />
                    <span style={{ fontWeight: 700 }}>{label}</span>
                  </div>
                  {p.status === "ok" && (
                    <>
                      <div className="stat-value">{p.daysRemaining}d</div>
                      <div className="stat-label">estimated remaining before {unit.toLowerCase()} crosses threshold</div>
                      <span className={`badge ${RISK_TONE[p.risk]}`} style={{ marginTop: 8, display: "inline-block" }}>Risk: {p.risk}</span>
                    </>
                  )}
                  {p.status === "insufficient-data" && <div className="empty-note">Insufficient data — {p.daysOfHistory} of {p.minRequired} required days recorded.</div>}
                  {p.status === "already-past-threshold" && <div className="empty-note" style={{ color: "var(--red)" }}>Already past the real degradation threshold (current: {p.currentValue}).</div>}
                  {p.status === "stable" && <div className="empty-note">Trend is flat/improving — no real degradation projected.</div>}
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>Observed telemetry, {p.daysOfHistory ?? 0} real day{(p.daysOfHistory ?? 0) !== 1 ? "s" : ""} of history — AI-derived projection, not a guarantee</div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="section-title">Battery / SSD Health Trend</h3>
            <p className="section-sub">Real daily snapshots — accumulates over time, not backfilled</p>
            {snapshotsLoading ? (
              <div className="empty-note">Loading snapshot history…</div>
            ) : snapshotsError ? (
              <div className="empty-note" style={{ color: "var(--red)" }}>Couldn't load snapshot history: {snapshotsError}</div>
            ) : chartData.length === 0 ? (
              <div className="empty-note">No daily snapshots recorded yet for this device.</div>
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                  <XAxis dataKey="date" stroke="var(--text-faint)" fontSize={11.5} />
                  <YAxis stroke="var(--text-faint)" fontSize={11.5} domain={[0, 100]} />
                  <Tooltip contentStyle={{ background: "var(--bg-panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }} />
                  <Legend />
                  <Line type="monotone" dataKey="Battery Health %" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                  <Line type="monotone" dataKey="SSD Wear %" stroke="var(--amber)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </>
      )}

      {tab === "approvals" && (
        <div className="card">
          <h3 className="section-title">Approval Requests</h3>
          <p className="section-sub">Real high-impact action requests from this device — approve/reject issues a real signed token</p>
          <ApprovalsTable
            approvals={approvals}
            loading={approvalsLoading}
            error={approvalsError}
            busyId={busyRequestId}
            onApprove={handleApproveRequest}
            onReject={handleRejectRequest}
            showDevice={false}
            emptyMessage="No approval requests from this device."
          />
        </div>
      )}

      {tab === "activity" && (
        <div className="card">
          <h3 className="section-title">Activity</h3>
          <p className="section-sub">Info-severity events for this device — routine, non-alerting activity · click a row for details</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Type</th><th>Message</th><th>When</th></tr></thead>
              <tbody>
                {deviceActivity.slice(0, 50).map((e) => (
                  <tr key={e.id} onClick={() => setSelectedEvent(e)} style={{ cursor: "pointer" }}>
                    <td>{e.eventType}</td>
                    <td className="truncate" style={{ maxWidth: 400 }} title={e.message}>{formatEventLine(e.message)}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                  </tr>
                ))}
                {deviceActivity.length === 0 && <tr><td colSpan={3} className="empty-note">No activity logged for this device yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          relatedIncident={relatedIncidentFor(selectedEvent)}
          onClose={() => setSelectedEvent(null)}
          onViewAlerts={() => { setTab("alerts"); setSelectedEvent(null); }}
        />
      )}
    </div>
  );
}
