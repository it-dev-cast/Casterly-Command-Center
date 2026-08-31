import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Siren, ShieldAlert, AlertTriangle, Info, Bot, Layers, Search } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import EventDetailPanel from "../components/EventDetailPanel.jsx";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { useDialog } from "../context/DialogContext.jsx";
import { api } from "../lib/api.js";

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

export default function Alerts() {
  const { events, devices, token, pushToast } = useLiveData();
  const { promptAsync } = useDialog();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [severityFilter, setSeverityFilter] = useState(searchParams.get("severity") || "all");
  const [deviceFilter, setDeviceFilter] = useState(searchParams.get("device") || "all");
  const [groupByDevice, setGroupByDevice] = useState(false);
  const [creatingId, setCreatingId] = useState(null);
  const [selectedEvent, setSelectedEvent] = useState(null);

  // Real, URL-shareable search over already-loaded event fields - same pattern Endpoints.jsx
  // already established (read + write, replace:true so it doesn't spam history per keystroke),
  // not a new capability, just the same real client-side filter applied here too.
  function updateQuery(next) {
    setQuery(next);
    const params = new URLSearchParams(searchParams);
    if (!next) params.delete("q"); else params.set("q", next);
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

  const q = query.trim().toLowerCase();
  const alerts = events.filter((e) => e.severity !== "info");
  const filtered = alerts
    .filter((e) => severityFilter === "all" || e.severity === severityFilter)
    .filter((e) => deviceFilter === "all" || e.deviceId === deviceFilter)
    .filter((e) => !q || e.message.toLowerCase().includes(q) || e.eventType.toLowerCase().includes(q) || e.deviceId.toLowerCase().includes(q));
  const criticalCount = alerts.filter((e) => e.severity === "critical").length;
  const warningCount = alerts.filter((e) => e.severity === "warning").length;
  const infoCount = events.filter((e) => e.severity === "info").length;

  // Real devices that have actually raised at least one alert - not the full fleet list, so the
  // filter dropdown never offers a device with nothing to show for it.
  const devicesWithAlerts = devices.filter((d) => alerts.some((e) => e.deviceId === d.id));
  function hostnameFor(deviceId) {
    return devices.find((d) => d.id === deviceId)?.hostname || deviceId;
  }

  // Real grouping, not a fabricated category - same rows, just partitioned by the real deviceId
  // each already carries, hostname-sorted so the grouping itself reads as intentional structure.
  const grouped = groupByDevice
    ? Object.entries(
        filtered.reduce((acc, e) => {
          (acc[e.deviceId] ||= []).push(e);
          return acc;
        }, {})
      ).sort(([a], [b]) => hostnameFor(a).localeCompare(hostnameFor(b)))
    : null;

  async function handleCreateIncident(event) {
    const title = await promptAsync("Incident title:", `${event.eventType} on ${event.deviceId}`);
    if (!title) return;
    setCreatingId(event.id);
    try {
      await api.createIncident(token, {
        deviceId: event.deviceId,
        sourceEventId: event.id,
        title,
        severity: event.severity,
      });
      pushToast("success", "Incident created", `"${title}" — check the Incidents page.`);
    } catch (e) {
      pushToast("error", "Incident creation failed", e.message);
    } finally {
      setCreatingId(null);
    }
  }

  function AlertRow({ e }) {
    return (
      <tr key={e.id} onClick={() => setSelectedEvent(e)} style={{ cursor: "pointer" }}>
        <td><span className={`badge ${e.severity === "critical" ? "red" : "amber"}`}>{e.severity}</span></td>
        <td>{e.eventType}</td>
        <td className="truncate" style={{ maxWidth: 340 }} title={e.message}>{e.message}</td>
        <td className="mono" style={{ fontSize: 11.5 }}>
          <Link to={`/endpoints/${e.deviceId}`} onClick={(evt) => evt.stopPropagation()} style={{ color: "var(--accent)" }}>{e.deviceId}</Link>
        </td>
        <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
        <td>
          <button className="btn" disabled={creatingId === e.id} onClick={(evt) => { evt.stopPropagation(); handleCreateIncident(e); }}>
            Create Incident
          </button>
        </td>
      </tr>
    );
  }

  return (
    <div>
      <h1 className="page-title">Alerts</h1>
      <p className="page-sub">Real warning/critical events from your fleet — pushed live over SSE, not polled</p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard icon={Siren} tone="purple" value={alerts.length} label="Total Alerts" meta="warning + critical" live />
        <StatCard icon={ShieldAlert} tone="red" value={criticalCount} label="Critical" live />
        <StatCard icon={AlertTriangle} tone="amber" value={warningCount} label="Warning" live />
        <StatCard icon={Info} tone="teal" value={infoCount} label="Info" meta="not shown below - see Activity / Audit" live />
        <StatCard icon={Bot} tone="blue" value={events.length} label="Total Events" meta="all severities" live />
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">Alert Stream</h3>
            <p className="section-sub">{filtered.length} alerts — promote one to an incident to start tracking it</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
            {["all", "critical", "warning"].map((s) => (
              <button
                key={s}
                className={`pill-select ${severityFilter === s ? "active" : ""}`}
                onClick={() => updateSeverityFilter(s)}
              >
                {s === "all" ? "All" : s[0].toUpperCase() + s.slice(1)}
              </button>
            ))}
            <select className="pill-select" value={deviceFilter} onChange={(e) => updateDeviceFilter(e.target.value)}>
              <option value="all">All Devices</option>
              {devicesWithAlerts.map((d) => <option key={d.id} value={d.id}>{d.hostname}</option>)}
            </select>
            <button
              className={`pill-select ${groupByDevice ? "active" : ""}`}
              onClick={() => setGroupByDevice((v) => !v)}
              title="Group the same real rows by device instead of chronologically"
            >
              <Layers size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
              Group by Device
            </button>
          </div>
        </div>

        <div className="search-box" style={{ width: "100%", marginBottom: 16 }}>
          <Search size={14} />
          <input
            value={query}
            onChange={(e) => updateQuery(e.target.value)}
            placeholder="Search by message, type, or device... (shareable via ?q=)"
            style={{ background: "transparent", border: "none", outline: "none", color: "inherit", font: "inherit", width: "100%" }}
          />
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Severity</th><th>Type</th><th>Message</th><th>Device</th><th>Raised</th><th>Actions</th></tr>
            </thead>
            <tbody>
              {!groupByDevice && filtered.map((e) => <AlertRow key={e.id} e={e} />)}
              {groupByDevice && grouped.flatMap(([deviceId, rows]) => [
                <tr key={`group-${deviceId}`} style={{ background: "var(--bg-panel-2)" }}>
                  <td colSpan={6} style={{ fontWeight: 700, fontSize: 12.5 }}>
                    <Link to={`/endpoints/${deviceId}`} style={{ color: "var(--accent)" }}>{hostnameFor(deviceId)}</Link>
                    <span style={{ color: "var(--text-faint)", fontWeight: 500 }}> — {rows.length} alert{rows.length !== 1 ? "s" : ""}</span>
                  </td>
                </tr>,
                ...rows.map((e) => <AlertRow key={e.id} e={e} />),
              ])}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={6} className="empty-note">
                    {alerts.length === 0
                      ? "No abnormal events yet — good sign. Real events will appear here the instant they're logged."
                      : q
                        ? `No alerts match "${query}".`
                        : "No alerts match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEvent && <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
