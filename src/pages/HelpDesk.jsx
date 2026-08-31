import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ClipboardList, Info, AlertTriangle, ShieldAlert, Tags, History, Download, Search } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import EventDetailPanel from "../components/EventDetailPanel.jsx";
import { useLiveData } from "../context/LiveDataContext.jsx";

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function exportEventsToCsv(rows) {
  const headers = ["Severity", "Type", "Message", "Device", "When"];
  const lines = rows.map((e) => [e.severity, e.eventType, e.message, e.deviceId, e.createdAt]
    .map((v) => `"${String(v ?? "").replace(/"/g, '""')}"`).join(","));
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `activity-log-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// This backend has one real event log (see backend/schema.sql's `events` table), not separate
// ticket/alert/call entities - eventType is a free-text field any part of the system (this
// device's own agent, a future admin action, ai-service) can populate. This page is the honest
// "everything that happened" view; Alerts & Incidents (previous page) is the same data filtered
// to warning/critical only.
export default function HelpDesk() {
  const { events } = useLiveData();
  const [typeFilter, setTypeFilter] = useState("all");
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");

  // Real, URL-shareable search over already-loaded event fields - same pattern
  // Endpoints.jsx/Alerts.jsx already established, not a new capability.
  function updateQuery(next) {
    setQuery(next);
    const params = new URLSearchParams(searchParams);
    if (!next) params.delete("q"); else params.set("q", next);
    setSearchParams(params, { replace: true });
  }

  const q = query.trim().toLowerCase();
  const eventTypes = ["all", ...new Set(events.map((e) => e.eventType))];
  const filtered = events
    .filter((e) => typeFilter === "all" || e.eventType === typeFilter)
    .filter((e) => !q || e.message.toLowerCase().includes(q) || e.eventType.toLowerCase().includes(q) || e.deviceId.toLowerCase().includes(q));

  const infoCount = events.filter((e) => e.severity === "info").length;
  const warningCount = events.filter((e) => e.severity === "warning").length;
  const criticalCount = events.filter((e) => e.severity === "critical").length;
  const distinctTypes = eventTypes.length - 1; // -1 for the synthetic "all" filter option
  const last24h = events.filter((e) => Date.now() - new Date(e.createdAt).getTime() < 86400000).length;

  return (
    <div>
      <h1 className="page-title">Activity / Audit</h1>
      <p className="page-sub">
        Real events across your fleet, all severities{" "}
        <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Current event window — up to 200 most recent. Click a row for details." />
      </p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard icon={ClipboardList} tone="blue" value={events.length} label="Total Events" live />
        <StatCard icon={Info} tone="teal" value={infoCount} label="Info" />
        <StatCard icon={AlertTriangle} tone="amber" value={warningCount} label="Warning" />
        <StatCard icon={ShieldAlert} tone="red" value={criticalCount} label="Critical" />
        <StatCard icon={Tags} tone="purple" value={distinctTypes} label="Distinct Event Types" />
        <StatCard icon={History} tone="gray" value={last24h} label="Last 24 Hours" live />
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">Event Log</h3>
            <p className="section-sub">{filtered.length} events in the current window</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <select className="pill-select" value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
              {eventTypes.map((t) => <option key={t} value={t}>{t === "all" ? "All types" : t}</option>)}
            </select>
            <button className="btn" onClick={() => exportEventsToCsv(filtered)}>
              <Download size={14} /> Export CSV
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
              <tr><th>Severity</th><th>Type</th><th>Message</th><th>Device</th><th>When</th></tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} onClick={() => setSelectedEvent(e)} style={{ cursor: "pointer" }}>
                  <td><span className={`badge ${e.severity === "critical" ? "red" : e.severity === "warning" ? "amber" : "blue"}`}>{e.severity}</span></td>
                  <td>{e.eventType}</td>
                  <td className="truncate" style={{ maxWidth: 360 }} title={e.message}>{e.message}</td>
                  <td className="mono" style={{ fontSize: 11.5 }}>
                    <Link to={`/endpoints/${e.deviceId}`} onClick={(evt) => evt.stopPropagation()} style={{ color: "var(--accent)" }}>{e.deviceId}</Link>
                  </td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={5} className="empty-note">
                    {events.length === 0 ? "No events yet." : q ? `No events match "${query}".` : "No events match the current filter."}
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
