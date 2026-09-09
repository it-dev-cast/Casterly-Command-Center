import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, ShieldAlert, Bell, ArrowRight, Siren, Sparkles, TrendingDown, TrendingUp, WifiOff, Info } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import EventDetailPanel from "../components/EventDetailPanel.jsx";
import { useLiveData, healthFromLiveStatus } from "../context/LiveDataContext.jsx";
import { useDialog } from "../context/DialogContext.jsx";
import { useRefetchOnEvent, isIncidentEvent, isApprovalEvent } from "../hooks/useRefetchOnEvent.js";
import { api } from "../lib/api.js";
import { predictDeviceHealth } from "../lib/prediction.js";
import { parseHardwareChanges } from "../lib/hardwareEvents.js";
import { deviceHealthDisplay } from "../lib/deviceLiveness.js";
import { shortDeviceTag } from "../lib/deviceId.js";
import { STATUS_LABELS, STATUS_TONE, OPEN_STATUSES } from "./Incidents.jsx";
import { REMEDIATION_ACTIONS } from "./DeviceDetail.jsx";

// Small reusable category eyebrow, matching the same uppercase-label convention Sidebar.jsx's
// own nav-group headers already use (.nav-label in index.css) - not a new visual pattern.
function CategoryLabel({ children }) {
  return <div className="nav-label" style={{ padding: "0 0 8px" }}>{children}</div>;
}

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// "What needs a decision right now" - every item here already exists as real data on some other
// page (Incidents, Lifecycle's ADE queue, Endpoints, notifications); this is a real cross-page
// aggregation lens over that same data, not a second parallel data source. No item here has a
// value that isn't traceable to one of api.js's existing real calls.
export default function ActionCenter() {
  const { token, devices, liveStatusByDevice, events, notifications, pushToast, offlineDeviceIds, offlineDevices } = useLiveData();
  const { promptAsync } = useDialog();
  const [incidents, setIncidents] = useState([]);
  const [incidentsError, setIncidentsError] = useState(null);
  const [incidentsLoading, setIncidentsLoading] = useState(true);
  const [approvals, setApprovals] = useState([]);
  const [approvalsError, setApprovalsError] = useState(null);
  const [approvalsLoading, setApprovalsLoading] = useState(true);
  const [busyRequestId, setBusyRequestId] = useState(null);
  const [aiSignals, setAiSignals] = useState([]);
  const [aiError, setAiError] = useState(null);
  const [aiLoading, setAiLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [busyIncidentId, setBusyIncidentId] = useState(null);
  const [remediationChoice, setRemediationChoice] = useState({}); // deviceId -> chosen action id
  const [busyRemediationDeviceId, setBusyRemediationDeviceId] = useState(null);
  const [promotingKey, setPromotingKey] = useState(null); // shared busy-key for both promote-to-incident actions below

  function refreshIncidents() {
    if (!token) return;
    setIncidentsLoading(true);
    api.listIncidents(token).then((list) => setIncidents(list.filter((i) => OPEN_STATUSES.includes(i.status))))
      .catch((e) => setIncidentsError(e.message)).finally(() => setIncidentsLoading(false));
  }
  useEffect(refreshIncidents, [token]);
  // Neither incidents nor approval requests have a dedicated SSE push (see useRefetchOnEvent's
  // own comment) - this is the real bridge that keeps both from going stale for an entire session
  // just because they were only ever fetched once on mount.
  useRefetchOnEvent(events, isIncidentEvent, refreshIncidents);
  useRefetchOnEvent(events, isApprovalEvent, refreshApprovals);

  useEffect(() => {
    if (!token) return;
    refreshApprovals();

    // Real fleet-wide AI signal: predictDeviceHealth (Stage A's exact port of ai-service's real
    // battery/SSD regression) run once per active device, over the same real metric-snapshots
    // Device 360/Lifecycle already fetch per-device - not a fabricated fleet score, just the real
    // per-device math run across every currently-loaded active device. Re-runs whenever the
    // active device count changes (same convention Dashboard/Endpoints/Lifecycle already use for
    // this same per-device-fetch pattern), not only on token change - a newly-enrolled device
    // previously never got an AI signal computed until the next login. Scales linearly with
    // active device count, which is fine at this fleet's real size but worth reconsidering if the
    // fleet grows very large.
    const activeDevices = devices.filter((d) => d.status === "active");
    if (activeDevices.length === 0) { setAiSignals([]); setAiError(null); setAiLoading(false); return; }
    setAiLoading(true);
    Promise.all(activeDevices.map((d) =>
      api.getDeviceMetricSnapshots(token, d.id)
        .then((snapshots) => ({ device: d, prediction: predictDeviceHealth(snapshots) }))
        .catch((e) => ({ error: e.message }))
    )).then((results) => {
      const failures = results.filter((r) => r?.error);
      setAiError(failures.length > 0 ? `${failures.length} of ${activeDevices.length} device prediction${failures.length === 1 ? "" : "s"} failed to load` : null);
      const signals = [];
      results.filter((r) => r && !r.error).forEach(({ device, prediction }) => {
        if (prediction.battery.status === "ok" && prediction.battery.risk === "High") {
          signals.push({ device, metric: "Battery Health", ...prediction.battery });
        }
        if (prediction.ssd.status === "ok" && prediction.ssd.risk === "High") {
          signals.push({ device, metric: "SSD", ...prediction.ssd });
        }
      });
      setAiSignals(signals);
    }).finally(() => setAiLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, devices.length]);

  async function refreshApprovals() {
    setApprovalsLoading(true);
    setApprovalsError(null);
    const list = await api.listApprovalRequests(token).catch((e) => { setApprovalsError(e.message); return []; });
    setApprovals(list);
    setApprovalsLoading(false);
  }

  async function handleApprove(id) {
    setBusyRequestId(id);
    try {
      await api.approveRequest(token, id);
      await refreshApprovals();
      pushToast("success", "Request approved", "The approval queue has been updated.");
    } catch (e) {
      pushToast("error", "Approval failed", e.message);
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleReject(id) {
    setBusyRequestId(id);
    try {
      await api.rejectRequest(token, id);
      await refreshApprovals();
      pushToast("success", "Request rejected", "The approval queue has been updated.");
    } catch (e) {
      pushToast("error", "Rejection failed", e.message);
    } finally {
      setBusyRequestId(null);
    }
  }

  // Incidents table quick-actions - same two-step real transition IncidentDetail.jsx's own
  // status buttons already drive, just the two earliest ones (open -> acknowledged ->
  // investigating). Anything further along (customer_contacted and later) has no quick action
  // here - open the incident itself for those, same as this table already links to.
  async function handleUpdateIncidentStatus(id, status) {
    setBusyIncidentId(id);
    try {
      await api.updateIncidentStatus(token, id, status);
      refreshIncidents();
      pushToast("success", "Incident updated", `Marked ${STATUS_LABELS[status]}.`);
    } catch (e) {
      pushToast("error", "Update failed", e.message);
    } finally {
      setBusyIncidentId(null);
    }
  }

  // Devices Needing Attention quick-action - same real dispatch Device 360's own remediation
  // buttons already use (api.enqueueCommand), just a compact dropdown+button for a table row
  // instead of a full button grid - there's no room here for six buttons per row. Device 360
  // still owns the richer "Pending…" tracking; this just queues and toasts.
  async function handleDispatchRemediation(deviceId) {
    const action = remediationChoice[deviceId] || REMEDIATION_ACTIONS[0].id;
    setBusyRemediationDeviceId(deviceId);
    try {
      await api.enqueueCommand(token, deviceId, action);
      pushToast("success", "Command queued", "The device will pick this up on its next check-in.");
    } catch (e) {
      if (e.status === 409) {
        pushToast("error", "Already pending", "This device already has a command awaiting pickup or execution.");
      } else {
        pushToast("error", "Failed to queue command", e.message);
      }
    } finally {
      setBusyRemediationDeviceId(null);
    }
  }

  // Shared "Promote to Incident" - same real api.createIncident call and promptAsync title
  // prompt Alerts.jsx's own handleCreateIncident already established; reused verbatim here for
  // both Hardware Changes and AI Signals rows rather than a third independent implementation.
  async function handlePromoteToIncident(key, { deviceId, sourceEventId, defaultTitle, severity }) {
    const title = await promptAsync("Incident title:", defaultTitle);
    if (!title) return;
    setPromotingKey(key);
    try {
      await api.createIncident(token, { deviceId, sourceEventId, title, severity });
      refreshIncidents();
      pushToast("success", "Incident created", `"${title}" — check the Incidents page.`);
    } catch (e) {
      pushToast("error", "Incident creation failed", e.message);
    } finally {
      setPromotingKey(null);
    }
  }

  const withHealth = devices.map((d) => ({ ...d, health: deviceHealthDisplay(healthFromLiveStatus(liveStatusByDevice[d.id]), offlineDeviceIds.has(d.id)) }));
  const attentionDevices = withHealth.filter((d) => d.status === "active" && (d.health === "warning" || d.health === "critical"))
    .sort((a, b) => (a.health === "critical" ? -1 : 1) - (b.health === "critical" ? -1 : 1));
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const unreadNotifications = notifications.filter((n) => !n.read);
  const criticalIncidents = incidents.filter((i) => i.severity === "critical");
  const criticalDevices = attentionDevices.filter((d) => d.health === "critical");
  // Real fleet-wide hardware-change rows, reusing the same shared parser HardwareIntegrity.jsx and
  // Device 360's own Hardware tab already use - not a second implementation.
  const hardwareChangeRows = events
    .filter((e) => e.eventType === "hardware-tamper-detected")
    .flatMap((e) => parseHardwareChanges(e.message).map((c, i) => ({ ...c, event: e, key: `${e.id}-${i}` })))
    .sort((a, b) => new Date(b.event.createdAt) - new Date(a.event.createdAt));
  const hardwareAffectedDeviceIds = new Set(hardwareChangeRows.map((r) => r.event.deviceId));

  const totalActionable = incidents.length + pendingApprovals.length + attentionDevices.length + unreadNotifications.length + aiSignals.length + offlineDevices.length + hardwareAffectedDeviceIds.size;

  return (
    <div>
      <h1 className="page-title">Action Center</h1>
      <p className="page-sub">
        What needs attention, investigation, or decision across your fleet{" "}
        <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="A real cross-fleet view over Incidents, ADE approvals, hardware changes, device health, liveness, notifications, and per-device AI signals — not a separate data source." />
      </p>

      {(criticalIncidents.length > 0 || criticalDevices.length > 0) && (
        <div className="card" style={{ marginBottom: 20, borderColor: "var(--red)", background: "rgba(var(--red-rgb), 0.06)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <Siren size={20} color="var(--red)" />
            <div>
              <div style={{ fontWeight: 700, color: "var(--red)" }}>CRITICAL</div>
              <div className="section-sub">
                {criticalIncidents.length > 0 && <Link to="/incidents?status=open" style={{ color: "inherit" }}>{criticalIncidents.length} critical incident{criticalIncidents.length !== 1 ? "s" : ""}</Link>}
                {criticalIncidents.length > 0 && criticalDevices.length > 0 && " · "}
                {criticalDevices.length > 0 && <Link to="/endpoints?health=critical" style={{ color: "inherit" }}>{criticalDevices.length} device{criticalDevices.length !== 1 ? "s" : ""} in critical health</Link>}
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard icon={AlertTriangle} tone="red" value={incidents.length} label="Open Incidents" meta={criticalIncidents.length ? `${criticalIncidents.length} critical` : undefined} live />
        <StatCard icon={ClipboardCheck} tone="amber" value={pendingApprovals.length} label="Pending Approvals" meta="ADE requests" live />
        <StatCard icon={ShieldAlert} tone={hardwareAffectedDeviceIds.size > 0 ? "amber" : "gray"} value={hardwareAffectedDeviceIds.size} label="Hardware Changes" meta="devices affected" live />
        <StatCard icon={ShieldAlert} tone="amber" value={attentionDevices.length} label="Devices Needing Attention" meta="warning or critical health" live />
        <StatCard icon={Sparkles} tone="purple" value={aiSignals.length} label="AI Signals" meta="devices at High risk (battery/SSD)" live={!aiLoading} />
        <StatCard icon={WifiOff} tone="gray" value={offlineDevices.length} label="Devices Offline" meta="liveness, not health" live />
        <StatCard icon={Bell} tone="blue" value={unreadNotifications.length} label="Unread Notifications" live />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <CategoryLabel>Incidents</CategoryLabel>
        <div className="section-head">
          <div>
            <h3 className="section-title">Open Incidents</h3>
            <p className="section-sub">Real incidents not yet resolved or closed</p>
          </div>
          <Link to="/incidents" className="btn" style={{ fontSize: 12 }}>View all <ArrowRight size={13} /></Link>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Title</th><th>Severity</th><th>Status</th><th>Opened</th><th>Actions</th></tr></thead>
            <tbody>
              {!incidentsLoading && incidents.map((i) => (
                <tr key={i.id}>
                  <td className="truncate" style={{ maxWidth: 320 }} title={i.title}><Link to={`/incidents/${i.id}`} style={{ color: "var(--accent)" }}>{i.title}</Link></td>
                  <td><span className={`badge ${i.severity === "critical" ? "red" : "amber"}`}>{i.severity}</span></td>
                  <td><span className={`badge ${STATUS_TONE[i.status]}`}>{STATUS_LABELS[i.status]}</span></td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(i.createdAt)}</td>
                  <td>
                    {i.status === "open" && (
                      <button className="btn" disabled={busyIncidentId === i.id} onClick={() => handleUpdateIncidentStatus(i.id, "acknowledged")}>Acknowledge</button>
                    )}
                    {i.status === "acknowledged" && (
                      <button className="btn" disabled={busyIncidentId === i.id} onClick={() => handleUpdateIncidentStatus(i.id, "investigating")}>Start Investigating</button>
                    )}
                  </td>
                </tr>
              ))}
              {incidentsLoading && <tr><td colSpan={5} className="empty-note">Loading incidents…</td></tr>}
              {!incidentsLoading && incidentsError && <tr><td colSpan={5} className="empty-note" style={{ color: "var(--red)" }}>Couldn't load incidents: {incidentsError}</td></tr>}
              {!incidentsLoading && !incidentsError && incidents.length === 0 && <tr><td colSpan={5} className="empty-note">No open incidents — the fleet is quiet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <CategoryLabel>Approvals</CategoryLabel>
        <div className="section-head">
          <div>
            <h3 className="section-title">Pending Approval Requests</h3>
            <p className="section-sub">Real high-impact action requests — approve/reject issues a real signed token</p>
          </div>
          <Link to="/approvals" className="btn" style={{ fontSize: 12 }}>View all <ArrowRight size={13} /></Link>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Action</th><th>Device</th><th>Requested</th><th>Actions</th></tr></thead>
            <tbody>
              {!approvalsLoading && pendingApprovals.map((a) => (
                <tr key={a.id}>
                  <td style={{ fontWeight: 600 }}>{a.action}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}><Link to={`/endpoints/${a.deviceId}`} style={{ color: "var(--accent)" }}>{a.deviceId}</Link></td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(a.createdAt)}</td>
                  <td>
                    <div style={{ display: "flex", gap: 6 }}>
                      <button className="btn primary" disabled={busyRequestId === a.id} onClick={() => handleApprove(a.id)}>Approve</button>
                      <button className="btn" disabled={busyRequestId === a.id} onClick={() => handleReject(a.id)}>Reject</button>
                    </div>
                  </td>
                </tr>
              ))}
              {approvalsLoading && <tr><td colSpan={4} className="empty-note">Loading approval requests…</td></tr>}
              {!approvalsLoading && approvalsError && <tr><td colSpan={4} className="empty-note" style={{ color: "var(--red)" }}>Couldn't load approval requests: {approvalsError}</td></tr>}
              {!approvalsLoading && !approvalsError && pendingApprovals.length === 0 && <tr><td colSpan={4} className="empty-note">No pending approval requests.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <CategoryLabel>Hardware Integrity</CategoryLabel>
        <div className="section-head">
          <div>
            <h3 className="section-title">Hardware Changes</h3>
            <p className="section-sub">Real hardware-tamper-detected events across the fleet — click a row for details</p>
          </div>
          <Link to="/hardware-integrity" className="btn" style={{ fontSize: 12 }}>View all <ArrowRight size={13} /></Link>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Device</th><th>Component</th><th>Change</th><th>Detected</th><th>Actions</th></tr></thead>
            <tbody>
              {hardwareChangeRows.slice(0, 8).map((r) => (
                <tr key={r.key} onClick={() => setSelectedEvent(r.event)} style={{ cursor: "pointer" }}>
                  <td><Link to={`/endpoints/${r.event.deviceId}`} onClick={(e) => e.stopPropagation()} style={{ color: "var(--accent)" }}>{devices.find((d) => d.id === r.event.deviceId)?.hostname || r.event.deviceId}</Link> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{shortDeviceTag(r.event.deviceId)}</span></td>
                  <td style={{ fontWeight: 600 }}>{r.field}</td>
                  <td className="mono truncate" style={{ maxWidth: 260, fontSize: 12 }} title={`${r.baseline} → ${r.current}`}>
                    <span style={{ color: "var(--text-faint)" }}>{r.baseline || "—"}</span> → {r.current || "—"}
                  </td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(r.event.createdAt)}</td>
                  <td>
                    <button
                      className="btn"
                      disabled={promotingKey === r.key}
                      onClick={(e) => {
                        e.stopPropagation();
                        handlePromoteToIncident(r.key, {
                          deviceId: r.event.deviceId,
                          sourceEventId: r.event.id,
                          defaultTitle: `Hardware change: ${r.field} on ${r.event.deviceId}`,
                          severity: r.event.severity,
                        });
                      }}
                    >
                      {promotingKey === r.key ? "Creating…" : "Promote to Incident"}
                    </button>
                  </td>
                </tr>
              ))}
              {hardwareChangeRows.length === 0 && <tr><td colSpan={5} className="empty-note">No hardware changes detected across the fleet.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid grid-2" style={{ gap: 20, marginBottom: 20 }}>
        <div className="card">
          <CategoryLabel>Device Health</CategoryLabel>
          <h3 className="section-title">Devices Needing Attention</h3>
          <p className="section-sub">Active devices currently reporting warning or critical health</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Device</th><th>Health</th><th>Actions</th></tr></thead>
              <tbody>
                {attentionDevices.map((d) => (
                  <tr key={d.id}>
                    <td><Link to={`/endpoints/${d.id}`} style={{ color: "var(--accent)" }}>{d.hostname}</Link> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{shortDeviceTag(d.id)}</span></td>
                    <td><span className={`badge ${d.health === "critical" ? "red" : "amber"}`}>{d.health}</span></td>
                    <td>
                      <div style={{ display: "flex", gap: 6 }}>
                        <select
                          className="pill-select"
                          value={remediationChoice[d.id] || REMEDIATION_ACTIONS[0].id}
                          onChange={(e) => setRemediationChoice((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        >
                          {REMEDIATION_ACTIONS.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                        </select>
                        <button className="btn" disabled={busyRemediationDeviceId === d.id} onClick={() => handleDispatchRemediation(d.id)}>
                          {busyRemediationDeviceId === d.id ? "Queuing…" : "Dispatch"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {attentionDevices.length === 0 && <tr><td colSpan={3} className="empty-note">All active devices are healthy.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <CategoryLabel>Notifications</CategoryLabel>
          <h3 className="section-title">Unread Notifications</h3>
          <p className="section-sub">Most recent, from the real notification stream</p>
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Event</th><th>Device</th><th>When</th></tr></thead>
              <tbody>
                {unreadNotifications.slice(0, 8).map((n) => (
                  <tr key={n.id}>
                    <td className="truncate" style={{ maxWidth: 220 }} title={n.message}>{n.eventType}</td>
                    <td><Link to={`/endpoints/${n.deviceId}`} style={{ color: "var(--accent)" }} className="mono" >{devices.find((d) => d.id === n.deviceId)?.hostname || n.deviceId}</Link> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{shortDeviceTag(n.deviceId)}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(n.createdAt)}</td>
                  </tr>
                ))}
                {unreadNotifications.length === 0 && <tr><td colSpan={3} className="empty-note">No unread notifications.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <CategoryLabel>Device Health</CategoryLabel>
        <h3 className="section-title">Devices Currently Offline</h3>
        <p className="section-sub">
          Liveness, not health{" "}
          <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Real-time: the later of lastSeenAt and live-status recency compared against the tenant's offline threshold, re-checked continuously - not dependent on the offline event still being in the recent event window. A stale device's health shows as 'stale,' not its last reading." />
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Device</th><th>Status</th></tr></thead>
            <tbody>
              {offlineDevices.map((d) => (
                <tr key={d.id}>
                  <td><Link to={`/endpoints/${d.id}`} style={{ color: "var(--accent)" }}>{d.hostname}</Link> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{shortDeviceTag(d.id)}</span></td>
                  <td><span className="badge gray">Offline</span></td>
                </tr>
              ))}
              {offlineDevices.length === 0 && <tr><td colSpan={2} className="empty-note">No active devices are currently offline.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <CategoryLabel>AI Signals</CategoryLabel>
        <h3 className="section-title">Devices at Elevated Hardware Risk</h3>
        <p className="section-sub">
          Only High-risk devices shown{" "}
          <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Real per-device battery/SSD wear projection — the same closed-form regression ai-service computes, run here across every active device's real snapshot history." />
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Device</th><th>Metric</th><th>Days Remaining</th><th>Risk</th><th>Confidence</th><th>Actions</th></tr></thead>
            <tbody>
              {!aiLoading && aiSignals.map((s, i) => {
                const key = `${s.device.id}-${s.metric}-${i}`;
                return (
                  <tr key={key}>
                    <td><Link to={`/endpoints/${s.device.id}`} style={{ color: "var(--accent)" }}>{s.device.hostname}</Link> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{shortDeviceTag(s.device.id)}</span></td>
                    <td>{s.metric === "Battery Health" ? <TrendingDown size={13} style={{ marginRight: 5, verticalAlign: "middle" }} /> : <TrendingUp size={13} style={{ marginRight: 5, verticalAlign: "middle" }} />}{s.metric}</td>
                    <td className="mono">{s.daysRemaining}d</td>
                    <td><span className="badge red">{s.risk}</span></td>
                    <td><span className={`badge ${s.confidence === "high" ? "green" : "gray"}`}>{s.confidence === "high" ? "High" : "Low"}</span></td>
                    <td>
                      <button
                        className="btn"
                        disabled={promotingKey === key}
                        onClick={() => handlePromoteToIncident(key, {
                          deviceId: s.device.id,
                          defaultTitle: `${s.metric} at High risk (${s.daysRemaining}d remaining) on ${s.device.id}`,
                          severity: "warning",
                        })}
                      >
                        {promotingKey === key ? "Creating…" : "Promote to Incident"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {aiLoading && <tr><td colSpan={6} className="empty-note">Computing real per-device predictions…</td></tr>}
              {!aiLoading && aiError && <tr><td colSpan={6} className="empty-note" style={{ color: "var(--red)" }}>Couldn't load some AI predictions: {aiError}</td></tr>}
              {!aiLoading && !aiError && aiSignals.length === 0 && <tr><td colSpan={6} className="empty-note">No devices currently show elevated hardware risk (or not enough snapshot history yet to project).</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {!incidentsLoading && !approvalsLoading && !aiLoading && totalActionable === 0 && (
        <div className="card" style={{ marginTop: 20, textAlign: "center", padding: "28px 20px" }}>
          <div className="empty-note">Nothing needs attention right now — the fleet is fully quiet.</div>
        </div>
      )}

      {selectedEvent && <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
