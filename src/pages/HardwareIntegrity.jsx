import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ShieldCheck, ShieldAlert, ShieldX, Users, RotateCcw, ExternalLink, Info } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import EventDetailPanel from "../components/EventDetailPanel.jsx";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { useRefetchOnEvent, isIncidentEvent } from "../hooks/useRefetchOnEvent.js";
import { api } from "../lib/api.js";
import { parseHardwareChanges } from "../lib/hardwareEvents.js";
import { computeWarrantyState } from "../lib/warrantyState.js";

function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Fleet-wide view of the same real hardware-tamper-detected / hardware-fingerprint-reset events
// Device 360's own Hardware tab already parses per-device (same shared parseHardwareChanges, not
// a second parser) - the tenant-wide events feed (already fetched by every page via
// useLiveData().events, same buffer Activity Log reads) already carries every device's events, so
// no new backend endpoint is needed here.
export default function HardwareIntegrity() {
  const { devices, events, token, entitlement } = useLiveData();
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [incidents, setIncidents] = useState([]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [deviceFilter, setDeviceFilter] = useState(searchParams.get("device") || "all");

  // Real incident relationship - reuses the same sourceEventId match IncidentDetail/DeviceDetail
  // already use, just looked up in the other direction (event -> incident instead of incident ->
  // event). One extra real fetch, explicitly requested by this stage's own "Hardware Integrity +
  // Incidents" section - not a decorative addition.
  function refreshIncidents() {
    if (!token) return;
    api.listIncidents(token).then(setIncidents).catch(() => {});
  }
  useEffect(refreshIncidents, [token]);
  // Incidents have no dedicated SSE push (see useRefetchOnEvent's own comment) - this is the real
  // bridge that keeps the "Related Incident" column from going stale for an entire session just
  // because it was only ever fetched once on mount.
  useRefetchOnEvent(events, isIncidentEvent, refreshIncidents);
  function incidentForEvent(eventId) {
    return incidents.find((i) => i.sourceEventId === eventId) || null;
  }

  function updateDeviceFilter(next) {
    setDeviceFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("device"); else params.set("device", next);
    setSearchParams(params, { replace: true });
  }

  function hostnameFor(deviceId) {
    return devices.find((d) => d.id === deviceId)?.hostname || deviceId;
  }

  const changeEvents = events.filter((e) => e.eventType === "hardware-tamper-detected" && (deviceFilter === "all" || e.deviceId === deviceFilter));
  const resetEvents = events.filter((e) => e.eventType === "hardware-fingerprint-reset" && (deviceFilter === "all" || e.deviceId === deviceFilter));
  const lockedCount = devices.filter((d) => d.fingerprintLockedAt).length;
  const affectedDeviceCount = new Set(changeEvents.map((e) => e.deviceId)).size;
  // Real devices that have actually raised a hardware event - not the full fleet, so the filter
  // never offers a device with nothing to show for it (same convention Alerts.jsx/Incidents.jsx
  // already use for their own device filters).
  const devicesWithHardwareEvents = devices.filter((d) =>
    events.some((e) => e.deviceId === d.id && (e.eventType === "hardware-tamper-detected" || e.eventType === "hardware-fingerprint-reset"))
  );
  // Real, honest v1 of PRD §6.4 (lib/warrantyState.js) - this page's own tamper/identity signal
  // is exactly what drives a device into Warranty "Warning", so it's the natural place to
  // surface how many devices that's currently true for, fleet-wide.
  const warrantyWarningCount = devices.filter(
    (d) => computeWarrantyState({ device: d, events, entitlementStatus: entitlement?.status }) === "Warning"
  ).length;

  // One real row per parsed field change, across every device's real event - the same shape
  // Device 360's Hardware tab table already uses, just not scoped to one device.
  const rows = changeEvents
    .flatMap((e) => parseHardwareChanges(e.message).map((c, i) => ({ ...c, event: e, key: `${e.id}-${i}` })))
    .sort((a, b) => new Date(b.event.createdAt) - new Date(a.event.createdAt));

  return (
    <div>
      <h1 className="page-title">Hardware Integrity</h1>
      <p className="page-sub">
        Real hardware-tamper detection across your whole fleet{" "}
        <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="The same events Device 360's Hardware tab shows per device, aggregated here. Current event window, up to 200 most recent events, same as Activity / Audit." />
      </p>

      <div className="grid grid-5" style={{ marginBottom: 20 }}>
        <StatCard icon={ShieldCheck} tone="green" value={lockedCount} label="Devices with Baseline Locked" meta={`of ${devices.length} registered`} live />
        <StatCard icon={ShieldAlert} tone={changeEvents.length > 0 ? "amber" : "green"} value={rows.length} label="Changes Detected" meta="field-level, in current window" live />
        <StatCard icon={Users} tone={affectedDeviceCount > 0 ? "amber" : "green"} value={affectedDeviceCount} label="Devices Affected" live />
        <StatCard icon={RotateCcw} tone="blue" value={resetEvents.length} label="Baseline Resets" live />
        <StatCard icon={ShieldX} tone={warrantyWarningCount > 0 ? "amber" : "green"} value={warrantyWarningCount} label="Warranty Warning" meta="PRD §6.4 state" live />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-head">
          <div>
            <h3 className="section-title">Detected Hardware Changes</h3>
            <p className="section-sub">Every real field-level change parsed from hardware-tamper-detected events in the current window, most recent first</p>
          </div>
          <select className="pill-select" value={deviceFilter} onChange={(e) => updateDeviceFilter(e.target.value)}>
            <option value="all">All Devices</option>
            {devicesWithHardwareEvents.map((d) => <option key={d.id} value={d.id}>{d.hostname}</option>)}
          </select>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Device</th><th>Component</th><th>Change</th><th>Detected</th><th>Status</th><th>Related Incident</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const relatedIncident = incidentForEvent(r.event.id);
                return (
                  <tr key={r.key} onClick={() => setSelectedEvent(r.event)} style={{ cursor: "pointer" }}>
                    <td><Link to={`/endpoints/${r.event.deviceId}`} onClick={(e) => e.stopPropagation()} style={{ color: "var(--accent)" }}>{hostnameFor(r.event.deviceId)}</Link></td>
                    <td style={{ fontWeight: 600 }}>{r.field}</td>
                    <td className="mono truncate" style={{ maxWidth: 260, fontSize: 12 }} title={`${r.baseline} → ${r.current}`}>
                      <span style={{ color: "var(--text-faint)" }}>{r.baseline || "—"}</span> → {r.current || "—"}
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(r.event.createdAt)}</td>
                    <td><span className="badge red">CHANGED</span></td>
                    <td>
                      {relatedIncident ? (
                        <Link to={`/incidents/${relatedIncident.id}`} onClick={(e) => e.stopPropagation()} className="btn" style={{ fontSize: 11.5, padding: "3px 8px", display: "inline-flex", alignItems: "center", gap: 4 }}>
                          {relatedIncident.title} <ExternalLink size={11} />
                        </Link>
                      ) : (
                        <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={6} className="empty-note">{changeEvents.length === 0 && deviceFilter === "all" ? "No hardware changes detected across the fleet." : "No hardware changes match the current filter."}</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title">Baseline Resets</h3>
        <p className="section-sub">
          A reset is a real state change — not automatically evidence of tampering{" "}
          <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Real hardware-fingerprint-reset events, fleet-wide — logged whenever an operator clears a device's baseline, e.g. after a legitimate hardware upgrade." />
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Device</th><th>Message</th><th>When</th></tr></thead>
            <tbody>
              {resetEvents.map((e) => (
                <tr key={e.id} onClick={() => setSelectedEvent(e)} style={{ cursor: "pointer" }}>
                  <td><Link to={`/endpoints/${e.deviceId}`} onClick={(evt) => evt.stopPropagation()} style={{ color: "var(--accent)" }}>{hostnameFor(e.deviceId)}</Link></td>
                  <td className="truncate" style={{ maxWidth: 400 }} title={e.message}>{e.message}</td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                </tr>
              ))}
              {resetEvents.length === 0 && <tr><td colSpan={3} className="empty-note">No baseline resets recorded in the current window.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {selectedEvent && <EventDetailPanel event={selectedEvent} onClose={() => setSelectedEvent(null)} />}
    </div>
  );
}
