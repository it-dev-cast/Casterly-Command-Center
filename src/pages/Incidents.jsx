import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardCheck, Clock, ShieldCheck, ShieldAlert, CheckCircle2, Archive, Info } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { useRefetchOnEvent, isIncidentEvent } from "../hooks/useRefetchOnEvent.js";
import { api } from "../lib/api.js";

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Exported so DeviceDetail's own incident table (a different view of the same real status field)
// reuses this exact mapping instead of a second, independently-hardcoded copy.
export const STATUS_LABELS = {
  open: "Open", acknowledged: "Acknowledged", investigating: "Investigating",
  customer_contacted: "Customer Contacted", service_scheduled: "Service Scheduled",
  in_repair: "In Repair", resolved: "Resolved", closed: "Closed",
};
export const STATUS_TONE = {
  open: "red", acknowledged: "amber", investigating: "amber", customer_contacted: "blue",
  service_scheduled: "blue", in_repair: "blue", resolved: "green", closed: "gray",
};
export const OPEN_STATUSES = ["open", "acknowledged", "investigating", "customer_contacted", "service_scheduled", "in_repair"];

export default function Incidents() {
  const { token, devices, events } = useLiveData();
  const [incidents, setIncidents] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [severityFilter, setSeverityFilter] = useState(searchParams.get("severity") || "all");
  const [deviceFilter, setDeviceFilter] = useState(searchParams.get("device") || "all");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);

  function updateStatusFilter(next) {
    setStatusFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("status"); else params.set("status", next);
    setSearchParams(params, { replace: true });
  }
  function updateSeverityFilter(next) {
    setSeverityFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("severity"); else params.set("severity", next);
    setSearchParams(params, { replace: true });
  }
  function updateDeviceFilter(next) {
    setDeviceFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("device"); else params.set("device", next);
    setSearchParams(params, { replace: true });
  }

  function refreshIncidents() {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    api.listIncidents(token).then(setIncidents).catch((e) => setLoadError(e.message)).finally(() => setLoading(false));
  }
  useEffect(refreshIncidents, [token]);
  // Incidents have no dedicated SSE push (see useRefetchOnEvent's own comment) - this is the real
  // bridge that keeps the queue from going stale for an entire session just because it was only
  // ever fetched once on mount.
  useRefetchOnEvent(events, isIncidentEvent, refreshIncidents);

  const filtered = incidents
    .filter((inc) => {
      if (statusFilter === "all") return true;
      if (statusFilter === "open") return OPEN_STATUSES.includes(inc.status);
      return inc.status === statusFilter;
    })
    .filter((inc) => severityFilter === "all" || inc.severity === severityFilter)
    .filter((inc) => deviceFilter === "all" || inc.deviceId === deviceFilter);

  // Real devices that have actually had an incident - not the full fleet, so the filter never
  // offers a device with nothing to show for it.
  const devicesWithIncidents = devices.filter((d) => incidents.some((inc) => inc.deviceId === d.id));

  const openCount = incidents.filter((inc) => OPEN_STATUSES.includes(inc.status)).length;
  const criticalOpen = incidents.filter((inc) => inc.severity === "critical" && OPEN_STATUSES.includes(inc.status)).length;
  const criticalTotal = incidents.filter((inc) => inc.severity === "critical").length;
  const resolvedCount = incidents.filter((inc) => inc.status === "resolved").length;
  const closedCount = incidents.filter((inc) => inc.status === "closed").length;

  // A real "insights" panel, computed from this tenant's own resolved incidents' actual
  // createdAt/resolvedAt timestamps - not a predictive model, not a fabricated confidence score
  // (the reference site's own "AI Insights" panel this was checked against uses exactly that
  // kind of made-up number, which this app's own no-fake-data discipline rules out).
  const resolvedWithTimes = incidents.filter((inc) => inc.status === "resolved" && inc.createdAt && inc.resolvedAt);
  const avgResolutionMs = resolvedWithTimes.length
    ? resolvedWithTimes.reduce((sum, inc) => sum + (new Date(inc.resolvedAt) - new Date(inc.createdAt)), 0) / resolvedWithTimes.length
    : null;

  function formatDuration(ms) {
    const hours = ms / (1000 * 60 * 60);
    if (hours < 1) return `${Math.max(1, Math.round(ms / (1000 * 60)))}m`;
    if (hours < 48) return `${hours.toFixed(1)}h`;
    return `${(hours / 24).toFixed(1)}d`;
  }

  return (
    <div>
      <h1 className="page-title">Incidents</h1>
      <p className="page-sub">Real tracked problems — promoted from alerts, or opened directly by an operator</p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard icon={ClipboardCheck} tone="blue" value={incidents.length} label="Total Incidents" />
        <StatCard icon={Clock} tone="red" value={openCount} label="Open / In Progress" />
        <StatCard icon={ShieldCheck} tone="amber" value={criticalOpen} label="Critical & Open" />
        <StatCard icon={ShieldAlert} tone="purple" value={criticalTotal} label="Critical (any status)" />
        <StatCard icon={CheckCircle2} tone="green" value={resolvedCount} label="Resolved" />
        <StatCard icon={Archive} tone="teal" value={closedCount} label="Closed" />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title">Resolution Insights</h3>
        <p className="section-sub">
          Real average from this tenant's resolved incidents{" "}
          <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="No predictive model, no fabricated confidence score." />
        </p>
        {resolvedWithTimes.length > 0 ? (
          <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginTop: 10 }}>
            <span className="stat-value" style={{ fontSize: 32 }}>{formatDuration(avgResolutionMs)}</span>
            <span style={{ color: "var(--text-dim)", fontSize: 13 }}>
              average time to resolution, across {resolvedWithTimes.length} resolved incident{resolvedWithTimes.length !== 1 ? "s" : ""}
            </span>
          </div>
        ) : (
          <div className="empty-note">Not enough resolved incidents yet to compute a real average.</div>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">Incident Queue</h3>
            <p className="section-sub">{filtered.length} incidents</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="pill-select" value={statusFilter} onChange={(e) => updateStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="open">Open / In Progress</option>
              {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select className="pill-select" value={severityFilter} onChange={(e) => updateSeverityFilter(e.target.value)}>
              <option value="all">All Severities</option>
              <option value="critical">Critical</option>
              <option value="warning">Warning</option>
            </select>
            <select className="pill-select" value={deviceFilter} onChange={(e) => updateDeviceFilter(e.target.value)}>
              <option value="all">All Devices</option>
              {devicesWithIncidents.map((d) => <option key={d.id} value={d.id}>{d.hostname}</option>)}
            </select>
          </div>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Severity</th><th>Incident</th><th>Device</th><th>Status</th><th>Opened</th><th>Updated</th><th></th></tr>
            </thead>
            <tbody>
              {!loading && filtered.map((inc) => (
                <tr key={inc.id}>
                  <td><span className={`badge ${inc.severity === "critical" ? "red" : "amber"}`}>{inc.severity}</span></td>
                  <td className="truncate" style={{ fontWeight: 600, maxWidth: 280 }} title={inc.title}>{inc.title}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}><Link to={`/endpoints/${inc.deviceId}`} style={{ color: "var(--accent)" }}>{inc.deviceId}</Link></td>
                  <td><span className={`badge ${STATUS_TONE[inc.status]}`}>{STATUS_LABELS[inc.status]}</span></td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(inc.createdAt)}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(inc.updatedAt)}</td>
                  <td><Link to={`/incidents/${inc.id}`} className="btn">Open</Link></td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={7} className="empty-note">Loading incidents…</td></tr>
              )}
              {!loading && loadError && (
                <tr><td colSpan={7} className="empty-note" style={{ color: "var(--red)" }}>Couldn't load incidents: {loadError}</td></tr>
              )}
              {!loading && !loadError && filtered.length === 0 && (
                <tr><td colSpan={7} className="empty-note">No incidents yet. Promote an alert from the Alerts page to open one.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
