import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, Lock, Cpu, MemoryStick, HardDrive, BatteryMedium, BatteryCharging, Disc, TrendingDown, TrendingUp,
  Search, ShieldCheck, ShieldAlert, AlertTriangle, Info, Thermometer, Gpu, Shield, RotateCw,
} from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from "recharts";
import { useLiveData, healthFromLiveStatus, CPU_USAGE_THRESHOLDS, RAM_USAGE_THRESHOLDS, DISK_USAGE_THRESHOLDS } from "../context/LiveDataContext.jsx";
import { useRefetchOnEvent, isIncidentEvent, isApprovalEvent } from "../hooks/useRefetchOnEvent.js";
import { useDialog } from "../context/DialogContext.jsx";
import { api } from "../lib/api.js";
import { predictDeviceHealth } from "../lib/prediction.js";
import { latestBatteryHealthPct, latestSsdWearPct, batteryHealthTone, ssdWearTone } from "../lib/batteryHealth.js";
import { getLiveDetail, dash, onOff, liveBatteryHealthPct, liveSsdWearPct, formatEventLine } from "../lib/liveDetail.js";
import { parseHardwareChanges } from "../lib/hardwareEvents.js";
import { deviceHealthDisplay } from "../lib/deviceLiveness.js";
import { computeDeviceHealthScore, healthScoreTone, getThermalInfo, HEALTH_SCORE_WEIGHTS } from "../lib/deviceHealthScore.js";
import { computeWarrantyState, warrantyStateTone } from "../lib/warrantyState.js";
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

// NVMe Base Spec 1.4 "Critical Warning" byte (SMART/Health Information Log) - the same 5 flag
// bits smartctl's own -a output names. telemetry-server.mjs sends the raw bitmask as-is (the real
// source fact); decoding it into a human label is display logic, so it lives here rather than in
// the agent, same as Windows Update's "Up to date"/"pending" text above.
const NVME_CRITICAL_WARNING_BITS = [
  { bit: 0x01, label: "Spare capacity low" },
  { bit: 0x02, label: "Temperature critical" },
  { bit: 0x04, label: "Reliability degraded" },
  { bit: 0x08, label: "Read-only mode" },
  { bit: 0x10, label: "Backup device failed" },
];
function decodeNvmeCriticalWarning(bitmask) {
  if (bitmask == null) return null;
  if (bitmask === 0) return "OK";
  const flagged = NVME_CRITICAL_WARNING_BITS.filter((b) => (bitmask & b.bit) !== 0).map((b) => b.label);
  return flagged.length > 0 ? flagged.join(", ") : `Unrecognized flag (0x${bitmask.toString(16)})`;
}

// Windows SoftwareLicensingProduct.LicenseStatus - a small, Microsoft-documented enum (unlike
// SecurityCenter2's productState), so decoded with confidence. telemetry-server.mjs sends the raw
// integer (the real source fact, already isolated from ~60 decoy placeholder SKU rows agent-side
// - see get-telemetry.ps1's own comment); decoding it into a label is display logic, same pattern
// as decodeNvmeCriticalWarning above.
const WINDOWS_LICENSE_STATUS_LABELS = {
  0: "Unlicensed",
  1: "Licensed",
  2: "Grace period (initial)",
  3: "Grace period (out-of-tolerance)",
  4: "Grace period (non-genuine)",
  5: "Notification (license expired)",
  6: "Extended grace period",
};
function decodeWindowsLicenseStatus(status) {
  if (status == null) return null;
  return WINDOWS_LICENSE_STATUS_LABELS[status] ?? `Unrecognized status (${status})`;
}

// Display order/labels for the six real dimensions computeDeviceHealthScore actually scores -
// weights read straight from HEALTH_SCORE_WEIGHTS (deviceHealthScore.js) rather than repeated
// here as separate numbers that could drift out of sync with the real formula.
const HEALTH_SCORE_DIMENSIONS = [
  { key: "hardwareIntegrity", label: "Hardware Integrity" },
  { key: "storageWear", label: "Storage Wear" },
  { key: "battery", label: "Battery" },
  { key: "osSoftwareHealth", label: "OS & Software Health" },
  { key: "thermal", label: "Thermal Performance" },
  { key: "security", label: "Security" },
];

// PRD §9 Self-Healing v1 remote dispatch - matches backend/device_commands.go's
// knownRemediationActions and telemetry-server.mjs's REMEDIATION_ACTIONS keys exactly.
const REMEDIATION_ACTIONS = [
  { id: "flush-dns", label: "Flush DNS Cache" },
  { id: "clean-temp", label: "Clean Temp Files" },
  { id: "restart-service", label: "Restart Print Spooler" },
  { id: "clear-teams-cache", label: "Clear Teams Cache" },
  { id: "repair-vpn", label: "Repair VPN Connection" },
  { id: "collect-bsod-diagnostics", label: "Collect BSOD Diagnostics" },
];

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
  const { token, devices, liveStatusByDevice, events, connected, revokeDevice, resetFingerprint, warrantyReview, pushToast, offlineDeviceIds, entitlement } = useLiveData();
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
  // PRD §9 Self-Healing v1 remote dispatch - remediationPending is the one action ID currently
  // awaiting completion (v1's one-pending-command-at-a-time constraint, enforced server-side too
  // - see device_commands.go), remediationSince is when it was enqueued (so the watcher below
  // only reacts to a NEW matching event, not an old one already sitting in the live buffer).
  const [remediationPending, setRemediationPending] = useState(null);
  const [remediationSince, setRemediationSince] = useState(null);
  const [remediationResult, setRemediationResult] = useState(null);
  const [busyRequestId, setBusyRequestId] = useState(null);
  const [tab, setTab] = useState("overview");
  const [eventTypeFilter, setEventTypeFilter] = useState("all");
  const [eventSeverityFilter, setEventSeverityFilter] = useState("all");
  const [eventSearch, setEventSearch] = useState("");
  const [selectedEvent, setSelectedEvent] = useState(null);

  const device = devices.find((d) => d.id === id);
  const liveStatus = liveStatusByDevice[id];
  const detail = getLiveDetail(liveStatus);
  // Real liveness, computed once centrally in LiveDataContext (offlineDeviceIds) - distinct from
  // `connected` (this browser tab's SSE pipe). A device can be genuinely offline while this tab's
  // SSE connection is still fine, so "LIVE" telemetry shouldn't claim currency it doesn't have in
  // that case.
  const deviceIsOffline = offlineDeviceIds.has(id);
  // health is gated on liveness before this component ever branches on it - a stale device's
  // frozen last reading displays as "stale," not a live-looking Critical/Warning state.
  const health = deviceHealthDisplay(healthFromLiveStatus(liveStatus), deviceIsOffline);
  // Same gate applied to every per-metric tone below (Overview/Telemetry StatCard grids) - a
  // stale 96% disk reading from 41 hours ago shouldn't still render red as if current.
  const toneIfLive = (t) => (deviceIsOffline ? "gray" : t);
  const issues = deviceIsOffline ? [] : currentIssues(liveStatus);
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

  function refreshIncidents() {
    if (!token || !id) return;
    setIncidentsError(null);
    setIncidentsLoading(true);
    api.listIncidents(token).then((list) => setIncidents(list.filter((i) => i.deviceId === id))).catch((e) => setIncidentsError(e.message)).finally(() => setIncidentsLoading(false));
  }

  useEffect(() => {
    if (!token || !id) return;
    setSnapshotsError(null);
    setSnapshotsLoading(true);
    api.getDeviceMetricSnapshots(token, id).then(setSnapshots).catch((e) => { setSnapshots([]); setSnapshotsError(e.message); }).finally(() => setSnapshotsLoading(false));
    refreshIncidents();
    refreshApprovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  // Neither incidents nor approval requests have a dedicated SSE push (see useRefetchOnEvent's
  // own comment) - this is the real bridge that keeps this device's Incidents/Approvals tabs from
  // going stale for an entire session just because they were only ever fetched once on mount/id
  // change. Scoped to this device's own id, same as the REST fetches above already are.
  useRefetchOnEvent(events, (e) => isIncidentEvent(e) && e.deviceId === id, refreshIncidents);
  useRefetchOnEvent(events, (e) => isApprovalEvent(e) && e.deviceId === id, refreshApprovals);

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

  // PRD §6.4 Warranty State Machine - the real, human-confirmed adjudication step UnderReview
  // requires. Deliberately sticky, with no "un-void" path (see backend/warranty.go's own
  // comment) - the confirm prompt says so plainly rather than letting an admin click through
  // without realizing this can't be undone from here.
  async function handleConfirmVoided() {
    const ok = await confirmAsync(`Confirm warranty voided for ${id}? This flags the reviewed tamper/identity event as genuine. This cannot be undone from here.`, "Confirm Voided");
    if (!ok) return;
    setBusy(true);
    try {
      await warrantyReview(id, "confirm-voided");
      pushToast("success", "Warranty voided", "Recorded as a confirmed, genuine hardware-tamper/identity finding.");
    } catch (e) {
      pushToast("error", "Confirm voided failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleDismissReview() {
    const ok = await confirmAsync(`Dismiss the warranty review for ${id} as a false positive? This resets its hardware baseline - the next hardware-check captures a fresh one.`, "Dismiss");
    if (!ok) return;
    setBusy(true);
    try {
      await warrantyReview(id, "dismiss");
      pushToast("success", "Review dismissed", "Baseline reset — next hardware-check will capture a fresh one.");
    } catch (e) {
      pushToast("error", "Dismiss failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  // PRD §9 Self-Healing v1 remote dispatch - enqueues on the backend; the device itself discovers
  // and runs it on its own next heartbeat poll (handleHeartbeat's pendingCommand), not
  // immediately. The 409 case (a command already pending for this device - v1's real, disclosed
  // one-at-a-time limit) is a genuine, expected outcome, not an unexpected error.
  async function handleRunRemediation(action) {
    try {
      await api.enqueueCommand(token, id, action);
      setRemediationPending(action);
      setRemediationSince(new Date());
      setRemediationResult(null);
      pushToast("success", "Command queued", "The device will pick this up on its next check-in.");
    } catch (e) {
      if (e.status === 409) {
        pushToast("error", "Already pending", "This device already has a command awaiting pickup or execution.");
      } else {
        pushToast("error", "Failed to queue command", e.message);
      }
    }
  }

  // No new GET endpoint - completion already fires a real remediation-succeeded/failed/blocked
  // event into the same live events stream this page already reads (useLiveData().events), so
  // this just watches for the next one matching the action just queued, same pattern
  // isDeviceCurrentlyTampered/useRefetchOnEvent elsewhere in this app already use.
  useEffect(() => {
    if (!remediationPending || !remediationSince) return;
    const match = events.find(
      (e) =>
        e.deviceId === id &&
        new Date(e.createdAt) >= remediationSince &&
        (e.eventType === `remediation-succeeded-${remediationPending}` ||
          e.eventType === `remediation-failed-${remediationPending}` ||
          e.eventType === `remediation-blocked-${remediationPending}`),
    );
    if (!match) return;
    const status = match.eventType.startsWith("remediation-succeeded")
      ? "Succeeded"
      : match.eventType.startsWith("remediation-blocked")
        ? "Blocked"
        : "Failed";
    const tone = status === "Succeeded" ? "green" : status === "Blocked" ? "gray" : "red";
    setRemediationResult({ action: remediationPending, status, tone, message: match.message });
    setRemediationPending(null);
    setRemediationSince(null);
  }, [events, remediationPending, remediationSince, id]);

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
  // Defender's own last-scan fact, shown as a single "Last Scan" row rather than two separate
  // Quick/Full rows - Defender only ever runs Quick Scans automatically in practice (a blank
  // Full Scan time is normal, not a gap), so whichever actually happened more recently is the
  // one real fact worth surfacing; the other stays available in detail if ever needed.
  const defenderQuickScanAt = detail.defenderQuickScanAt ?? null;
  const defenderFullScanAt = detail.defenderFullScanAt ?? null;
  const defenderLastScanAt =
    defenderQuickScanAt == null
      ? defenderFullScanAt
      : defenderFullScanAt == null
        ? defenderQuickScanAt
        : new Date(defenderFullScanAt) > new Date(defenderQuickScanAt)
          ? defenderFullScanAt
          : defenderQuickScanAt;
  // Composite Device Health Score - real math over the same real batteryHealthPct/ssdWearPct
  // this page already displays elsewhere, plus device/events for the hardware-integrity
  // dimension (see deviceHealthScore.js's own comment on why that one's event-derived). Not
  // computed at all while offline - five of these six dimensions are last-known live readings
  // (hardwareIntegrity is the one derived from device/events, not liveStatus), and a composite
  // built from them would look exactly as current as a genuinely live score, the one thing this
  // number must never do (same reasoning the Health badge above already applies via
  // deviceHealthDisplay).
  const healthScore = deviceIsOffline
    ? { overall: null, dimensions: {} }
    : computeDeviceHealthScore({
        device, events, batteryHealthPct, storageWearPct: ssdWearPct,
        windowsUpdatePendingCount: detail.windowsUpdatePendingCount ?? null,
        windowsUpdateCheckedAt: detail.windowsUpdateCheckedAt ?? null,
        cpuTempC: detail.cpuTempC ?? null, gpuTempC: detail.gpuTempC ?? null,
        storageCriticalWarning: detail.storageCriticalWarning ?? null,
        storageMediaErrors: detail.storageMediaErrors ?? null,
        tpmActive: detail.tpmActive ?? null,
        secureBootEnabled: detail.secureBootEnabled ?? null,
        bitlockerOn: detail.bitlockerOn ?? null,
        mdmEnrolled: detail.mdmEnrolled ?? null,
        domainJoined: detail.domainJoined ?? null,
        azureAdJoined: detail.azureAdJoined ?? null,
        enterpriseJoined: detail.enterpriseJoined ?? null,
        avProductNames: detail.avProductNames ?? null,
        biosFirmwareUpdateAvailable: detail.biosFirmwareUpdateAvailable ?? null,
        biosFirmwareCheckedAt: detail.biosFirmwareCheckedAt ?? null,
        defenderSignatureLastUpdated: detail.defenderSignatureLastUpdated ?? null,
      });
  // Same offline gate as healthScore above - a frozen temperature reading from an offline
  // device is exactly the same "looks current, isn't" problem, even for this supplementary
  // raw-value display rather than the composite itself.
  const thermal = deviceIsOffline ? { available: false, cpuTempC: null, gpuTempC: null } : getThermalInfo(liveStatus);
  // Unlike healthScore above, not gated on deviceIsOffline - PRD §6.4 Warranty state is a derived
  // fact from baseline-lock + past events + entitlement standing, not a live sensor reading that
  // would misleadingly look current while frozen (see lib/warrantyState.js's own comment).
  const warrantyState = computeWarrantyState({ device, events, entitlementStatus: entitlement?.status });
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
          {/* PRD §6.4 Warranty State Machine - the real adjudication actions, shown only while a
              review is actually pending (warrantyState === "UnderReview"), matching the same
              conditional convention Revoke already uses just below. */}
          {warrantyState === "UnderReview" && (
            <>
              <button className="btn danger" onClick={handleConfirmVoided} disabled={busy}>Confirm Voided</button>
              <button className="btn" onClick={handleDismissReview} disabled={busy}>Dismiss</button>
            </>
          )}
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
            {health === "unknown" ? "no data" : health === "stale" ? "not reporting" : health}
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
                <Kv
                  label="Warranty"
                  value={<span className={`badge ${warrantyStateTone(warrantyState)}`} title="PRD §6.4 Warranty State - baseline integrity + subscription standing">{warrantyState ?? "—"}</span>}
                />
              </div>
            </div>
            <div className="card">
              <h3 className="section-title">Security</h3>
              <div className="kv-list" style={{ marginTop: 4 }}>
                <Kv label="Score" value={dash(detail.securityHealthPct, "%")} />
                <Kv label="TPM" value={onOff(detail.tpmActive)} />
                <Kv label="Secure Boot" value={onOff(detail.secureBootEnabled)} />
                <Kv label="BitLocker" value={onOff(detail.bitlockerOn)} />
                {/* Real hourly Windows Update check (runWindowsUpdateCheck) - now reaching the
                    backend, not yet folded into the composite score below (deliberate next
                    step, see deviceHealthScore.js's own comment). checkedAt null means this
                    device hasn't completed its first hourly check yet, distinct from a real 0. */}
                <Kv
                  label="Windows Updates"
                  value={
                    detail.windowsUpdateCheckedAt == null
                      ? "—"
                      : detail.windowsUpdatePendingCount === 0
                        ? "Up to date"
                        : `${detail.windowsUpdatePendingCount} pending`
                  }
                />
                {/* Real last-boot timestamp (Win32_OperatingSystem.LastBootUpTime) - plain,
                    neutral display, no color/severity treatment. There's no honest way to tell
                    a concerning unexpected reboot from a routine one (nightly policy, an
                    intentional restart, waking from sleep) using uptime alone, so this shows the
                    fact and nothing more. */}
                <Kv label="Last Reboot" value={detail.lastBootTime == null ? "—" : timeAgo(detail.lastBootTime)} />
                {/* Real Windows license/activation status - no fabricated severity, just the
                    honest state. licenseFamily/licenseChannel (e.g. "Professional" /
                    "OEM:DM") shown alongside the decoded status for real context, not just a
                    bare "Licensed"/"Unlicensed". */}
                <Kv
                  label="Windows License"
                  value={
                    detail.windowsLicenseStatus == null
                      ? "—"
                      : `${decodeWindowsLicenseStatus(detail.windowsLicenseStatus)}${detail.windowsLicenseFamily ? ` (${detail.windowsLicenseFamily}${detail.windowsLicenseChannel ? `, ${detail.windowsLicenseChannel}` : ""})` : ""}`
                  }
                />
                {/* Real hourly BIOS/firmware check (runBiosFirmwareUpdateCheck) - same WUA
                    search cadence as Windows Update above, filtered to System Firmware driver
                    entries. Deliberately NOT folded into the composite score below (see PRD
                    scope for this - a separate decision from just making this real and
                    visible). checkedAt null means this device hasn't completed its first
                    hourly check yet, distinct from a real "up to date". */}
                <Kv
                  label="BIOS/Firmware"
                  value={
                    detail.biosFirmwareCheckedAt == null
                      ? "—"
                      : !detail.biosFirmwareUpdateAvailable
                        ? "Up to date"
                        : detail.biosFirmwareLatestVersion
                          ? `Update available (${detail.biosFirmwareLatestVersion})`
                          : "Update available"
                  }
                />
                {/* Real hourly domain-join/Azure AD-join/MDM-enrollment check (runDomainMdmCheck,
                    dsregcmd /status) - same cadence as Windows Update/BIOS above. Deliberately NOT
                    folded into the composite score below (same "make it real and visible first"
                    scope as BIOS/Windows Update - see deviceHealthScore.js). checkedAt null means
                    this device hasn't completed its first hourly check yet, distinct from a real
                    "not joined". Join type prioritizes Domain > Azure AD > Enterprise (legacy
                    on-prem Workplace Join) > Workplace (Azure AD Registered/BYOD) since a device
                    can genuinely be true on more than one (e.g. hybrid Azure AD join is both
                    domain- and Azure-AD-joined) - this shows the most complete real join present. */}
                <Kv
                  label="Domain/MDM"
                  value={
                    detail.domainMdmCheckedAt == null
                      ? "—"
                      : `${
                          detail.domainJoined
                            ? "Domain-joined"
                            : detail.azureAdJoined
                              ? "Azure AD-joined"
                              : detail.enterpriseJoined
                                ? "Enterprise-joined"
                                : detail.workplaceJoined
                                  ? "Workplace-joined"
                                  : "Not joined"
                        }${detail.mdmEnrolled ? " · MDM-enrolled" : ""}`
                  }
                />
                {/* Real Windows Defender status (MSFT_MpComputerStatus) + SecurityCenter2's
                    registered-AV-product list (covers third-party AV too, not just Defender -
                    a machine with Defender disabled in favor of e.g. Norton would show that
                    product's real name here instead). Deliberately not decoding
                    SecurityCenter2's own productState bitmask - undocumented, unofficial, and
                    redundant with Defender's own clean booleans for the one product with a real
                    first-party API. Not folded into securityHealthPct below - same "visible and
                    honest first" scope as every other signal added tonight. */}
                <Kv label="Real-Time Protection" value={onOff(detail.defenderRealTimeProtectionEnabled)} />
                <Kv
                  label="Virus Definitions"
                  value={detail.defenderSignatureLastUpdated == null ? "—" : `Updated ${timeAgo(detail.defenderSignatureLastUpdated)}`}
                />
                <Kv label="Last Scan" value={defenderLastScanAt == null ? "—" : timeAgo(defenderLastScanAt)} />
                <Kv
                  label="AV Products"
                  value={
                    detail.avProductNames == null
                      ? "—"
                      : detail.avProductNames.length === 0
                        ? "None registered"
                        : detail.avProductNames.join(", ")
                  }
                />
              </div>
              <p className="section-sub" style={{ marginTop: 10 }}>TPM/Secure Boot/BitLocker are the same three signals as the agent title-bar — missing sensors stay —</p>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <div className="section-head">
              <div>
                <h3 className="section-title">Device Health Score</h3>
                <p className="section-sub">
                  Real composite across all 6 of the PRD's dimensions{" "}
                  <Info
                    size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }}
                    title="Hardware Integrity 30%, Storage Wear 20%, Battery 15%, OS & Software Health 15%, Thermal Performance 10%, Security 10% - real weights, renormalized per device over whichever of these are actually available for it."
                  />
                </p>
              </div>
              <div style={{ textAlign: "right", flexShrink: 0 }}>
                <div style={{ fontSize: 34, fontWeight: 800, lineHeight: 1, color: `var(--${healthScoreTone(healthScore.overall)})` }}>
                  {healthScore.overall ?? "—"}
                </div>
                <div className="section-sub" style={{ marginTop: 2 }}>out of 100</div>
              </div>
            </div>
            <div className="grid grid-2" style={{ gap: 10, marginTop: 10 }}>
              {HEALTH_SCORE_DIMENSIONS.map(({ key, label }) => {
                const dim = healthScore.dimensions[key] ?? { score: null, available: false };
                return (
                  <div key={key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "7px 10px", background: "var(--bg-panel-2)", borderRadius: "var(--radius)" }}>
                    <span style={{ fontSize: 12.5 }}>{label} <span className="section-sub">({HEALTH_SCORE_WEIGHTS[key]}%)</span></span>
                    <span style={{ fontSize: 13, fontWeight: 700, color: dim.available ? `var(--${healthScoreTone(dim.score)})` : "var(--text-faint)" }}>
                      {dim.available ? dim.score : "Not available"}
                    </span>
                  </div>
                );
              })}
            </div>
            <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-soft)", fontSize: 12.5, color: "var(--text-faint)" }}>
              Thermal detail (folded into Thermal Performance above): {thermal.available
                ? [thermal.cpuTempC != null ? `CPU ${Math.round(thermal.cpuTempC)}°C` : null, thermal.gpuTempC != null ? `GPU ${Math.round(thermal.gpuTempC)}°C` : null].filter(Boolean).join(" · ")
                : "not available on this device"}
            </div>
          </div>

          <div className="card" style={{ marginBottom: 20 }}>
            <h3 className="section-title">Remediation</h3>
            <p className="section-sub">
              PRD §9 Self-Healing — real remote dispatch. The device runs this on its own next check-in, not instantly.
            </p>
            <div className="grid grid-3" style={{ gap: 10, marginTop: 10 }}>
              {REMEDIATION_ACTIONS.map((a) => (
                <button
                  key={a.id}
                  className="btn"
                  disabled={remediationPending != null}
                  onClick={() => handleRunRemediation(a.id)}
                >
                  {remediationPending === a.id ? "Pending…" : a.label}
                </button>
              ))}
            </div>
            {remediationResult && (
              <div style={{ marginTop: 12, display: "flex", alignItems: "flex-start", gap: 8 }}>
                <span className={`badge ${remediationResult.tone}`}>{remediationResult.status}</span>
                <span style={{ fontSize: 12.5, color: "var(--text-faint)" }}>{remediationResult.message}</span>
              </div>
            )}
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
                <StatCard icon={Cpu} tone={toneIfLive(usageTone(liveStatus.cpuPct, CPU_USAGE_THRESHOLDS))} value={dash(liveStatus.cpuPct, "%")} label="CPU" meta={detail.cpuName} live={liveDot} />
                <StatCard icon={MemoryStick} tone={toneIfLive(usageTone(liveStatus.ramPct, RAM_USAGE_THRESHOLDS))} value={dash(liveStatus.ramPct, "%")} label="RAM" meta={detail.memTotalGB != null ? `${detail.memTotalGB} GB` : null} live={liveDot} />
                <StatCard icon={HardDrive} tone={toneIfLive(usageTone(liveStatus.diskPct, DISK_USAGE_THRESHOLDS))} value={dash(liveStatus.diskPct, "%")} label="Disk" meta={detail.driveModel} live={liveDot} />
                <StatCard icon={BatteryCharging} tone={toneIfLive(batteryTone(liveStatus.batteryPct))} value={dash(liveStatus.batteryPct, "%")} label="Charge" live={liveDot} />
                <StatCard icon={BatteryMedium} tone={toneIfLive(batteryHealthTone(batteryHealthPct))} value={dash(batteryHealthPct, "%")} label="Battery Health" live={liveDot && detail.batteryHealthPct != null} />
                <StatCard icon={Shield} tone={toneIfLive(detail.securityHealthPct == null ? "gray" : detail.securityHealthPct === 100 ? "green" : "amber")} value={dash(detail.securityHealthPct, "%")} label="Security" live={liveDot && detail.securityHealthPct != null} />
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
              from predictDeviceHealth(snapshots) below; no second calculation, no fabricated root
              cause - just a condensed view of the same real statuses. "ok" rows now carry a real
              confidence tier (see prediction.js's R2 gate); only the low-confidence exception is
              flagged inline, so a well-fit projection reads unchanged. */}
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
                  {p.status === "ok" && (
                    <span className={`badge ${RISK_TONE[p.risk]}`}>
                      {p.daysRemaining}d remaining — {p.risk} risk
                      {p.confidence === "low" && <span style={{ color: "var(--text-faint)" }}> · low confidence</span>}
                    </span>
                  )}
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
            <StatCard icon={Cpu} tone={toneIfLive(usageTone(liveStatus?.cpuPct, CPU_USAGE_THRESHOLDS))} value={dash(liveStatus?.cpuPct, "%")} label="CPU" meta={detail.cpuName} live={liveDot} />
            <StatCard icon={MemoryStick} tone={toneIfLive(usageTone(liveStatus?.ramPct, RAM_USAGE_THRESHOLDS))} value={dash(liveStatus?.ramPct, "%")} label="RAM" meta={detail.memTotalGB != null ? `${detail.memTotalGB} GB` : null} live={liveDot} />
            <StatCard icon={HardDrive} tone={toneIfLive(usageTone(liveStatus?.diskPct, DISK_USAGE_THRESHOLDS))} value={dash(liveStatus?.diskPct, "%")} label="Disk" meta={detail.diskFreeGB != null ? `${detail.diskFreeGB} GB free` : null} live={liveDot} />
            <StatCard icon={BatteryCharging} tone={toneIfLive(batteryTone(liveStatus?.batteryPct))} value={dash(liveStatus?.batteryPct, "%")} label="Charge" live={liveDot} />
            <StatCard icon={BatteryMedium} tone={toneIfLive(batteryHealthTone(batteryHealthPct))} value={dash(batteryHealthPct, "%")} label="Battery Health" live={liveDot && detail.batteryHealthPct != null} />
            {/* Real battery cycle count - but only when rust's own independent reading
                corroborates the concept is supported on this hardware (see telemetry-server.mjs's
                collect() merge comment): root/wmi's raw BatteryCycleCount is cross-validated as
                unreliable on this exact real machine (a "0" with no error, for a battery already
                at 44% design-capacity wear - implausible for a genuinely 0-cycle battery), so a
                null here means "unverifiable on this hardware," not "definitely zero." Battery
                temperature is deliberately NOT surfaced anywhere - confirmed absent on this real
                machine via two independent sources (LibreHardwareMonitor and rust's own Windows
                Battery API), a genuine hardware ceiling, same category as this project's known
                fan-RPM gap. */}
            <StatCard icon={RotateCw} tone={toneIfLive(detail.batteryCycleCount == null ? "gray" : "teal")} value={dash(detail.batteryCycleCount)} label="Battery Cycles" live={liveDot && detail.batteryCycleCount != null} />
            <StatCard icon={Disc} tone={toneIfLive(ssdWearTone(ssdWearPct))} value={dash(ssdWearPct, "%")} label="SSD Wear" live={liveDot && detail.storageWearPct != null} />
            {/* Real NVMe media_errors/critical_warning from nvme_smart_health_information_log -
                NVMe has no ATA-style Reallocated_Sector_Ct equivalent (confirmed directly against
                a real smartctl -a -j -d nvme run - no such field exists on this protocol, not
                just unparsed), so this shows what NVMe actually exposes instead: media_errors is
                the real lifetime count of unrecovered data-integrity errors; critical_warning is
                the controller's own 5-bit health bitmask, decoded to text below. Neither is folded
                into the composite Health Score - same "visible and honest first" scope as
                BIOS/Windows Update/Domain-MDM above. */}
            <StatCard icon={AlertTriangle} tone={toneIfLive(detail.storageMediaErrors == null ? "gray" : detail.storageMediaErrors > 0 ? "red" : "green")} value={dash(detail.storageMediaErrors)} label="Media Errors" live={liveDot && detail.storageMediaErrors != null} />
            <StatCard
              icon={detail.storageCriticalWarning == null ? Shield : detail.storageCriticalWarning === 0 ? ShieldCheck : ShieldAlert}
              tone={toneIfLive(detail.storageCriticalWarning == null ? "gray" : detail.storageCriticalWarning === 0 ? "green" : "red")}
              value={decodeNvmeCriticalWarning(detail.storageCriticalWarning) ?? "—"}
              label="Drive Health"
              live={liveDot && detail.storageCriticalWarning != null}
            />
            <StatCard icon={Thermometer} tone={toneIfLive(detail.cpuTempC == null ? "gray" : detail.cpuTempC >= 85 ? "red" : "teal")} value={detail.cpuTempC != null ? `${Math.round(detail.cpuTempC)}°C` : "—"} label="CPU Temp" live={liveDot && detail.cpuTempC != null} />
            <StatCard icon={Gpu} tone={toneIfLive(detail.gpuUtilPct == null ? "gray" : "purple")} value={dash(detail.gpuUtilPct, "%")} label="GPU" meta={detail.gpuName} live={liveDot && detail.gpuUtilPct != null} />
            <StatCard icon={Thermometer} tone={toneIfLive(detail.gpuTempC == null ? "gray" : "purple")} value={detail.gpuTempC != null ? `${Math.round(detail.gpuTempC)}°C` : "—"} label="GPU Temp" live={liveDot && detail.gpuTempC != null} />
            <StatCard icon={Shield} tone={toneIfLive(detail.securityHealthPct == null ? "gray" : detail.securityHealthPct === 100 ? "green" : "amber")} value={dash(detail.securityHealthPct, "%")} label="Security" live={liveDot && detail.securityHealthPct != null} />
          </div>
          {!liveStatus && <div className="empty-note" style={{ marginTop: 12 }}>No live telemetry received from this device yet.</div>}
          {liveStatus && deviceIsOffline && <div className="empty-note" style={{ marginTop: 12, color: "var(--amber)" }}>This device is currently offline — the values above are its last reported readings, not current.</div>}
          {/* Full per-volume breakdown (Win32_LogicalDisk, every local fixed volume - not just
              C:) - the Disk tile above only ever shows the single worst/fullest one. No
              per-volume severity tone beyond what the Disk tile already uses (DISK_USAGE_THRESHOLDS)
              - not inventing a second threshold scale for the same underlying usage-percentage fact. */}
          {Array.isArray(detail.volumes) && detail.volumes.length > 0 && (
            <div style={{ marginTop: 16 }}>
              <p className="section-sub" style={{ marginBottom: 8, fontWeight: 600 }}>Volumes</p>
              <div className="table-scroll">
                <table className="data-table">
                  <thead><tr><th>Drive</th><th>Label</th><th>Size</th><th>Free</th></tr></thead>
                  <tbody>
                    {detail.volumes.map((v) => {
                      const usedPct = v.sizeGB > 0 && v.freeGB != null ? ((v.sizeGB - v.freeGB) / v.sizeGB) * 100 : null;
                      const tone = usedPct != null ? usageTone(usedPct, DISK_USAGE_THRESHOLDS) : "gray";
                      const toneColor = { red: "var(--red)", amber: "var(--amber)", green: "var(--green)", gray: "var(--text-faint)" }[tone];
                      return (
                        <tr key={v.letter}>
                          <td className="mono">{v.letter}</td>
                          <td>{dash(v.label)}</td>
                          <td>{dash(v.sizeGB, " GB")}</td>
                          <td style={{ color: toneColor }}>{dash(v.freeGB, " GB")}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
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
                {/* Real installed-vs-total RAM slot count (Win32_PhysicalMemory module count vs.
                    Win32_PhysicalMemoryArray.MemoryDevices) - honest fact only, no "should
                    upgrade" recommendation. Gated on ramSlotsTotal specifically since that's the
                    genuinely new collection; ramSlotsUsed shows as "—" on its own if the module
                    list ever comes back empty this cycle while the slot count is still known. */}
                <Kv
                  label="RAM slots"
                  value={detail.ramSlotsTotal == null ? "—" : `${detail.ramSlotsUsed ?? "—"} of ${detail.ramSlotsTotal} used`}
                />
                <Kv label="Disk" value={dash(detail.driveModel)} />
                <Kv label="SSD wear" value={dash(ssdWearPct, "%")} />
              </div>
              <div className="kv-list">
                <Kv label="GPU" value={dash(detail.gpuName)} />
                <Kv label="GPU util" value={dash(detail.gpuUtilPct, "%")} />
                <Kv label="GPU temp" value={detail.gpuTempC != null ? `${Math.round(detail.gpuTempC)}°C` : "—"} />
                {/* Real GPU driver version + date (Win32_VideoController) - plain factual display,
                    no staleness/severity judgment. Same reasoning as Last Reboot: there's no
                    honest universal "too old" threshold without knowing this specific GPU
                    vendor's own release cadence. */}
                <Kv
                  label="GPU driver"
                  value={
                    detail.gpuDriverVersion == null
                      ? "—"
                      : `${detail.gpuDriverVersion}${detail.gpuDriverDate ? ` (${new Date(detail.gpuDriverDate).toLocaleDateString()})` : ""}`
                  }
                />
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
                      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Confidence: {p.confidence === "high" ? "High" : "Low"}</div>
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
