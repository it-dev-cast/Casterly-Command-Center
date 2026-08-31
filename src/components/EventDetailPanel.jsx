import { Link } from "react-router-dom";
import { X, ExternalLink } from "lucide-react";
import { parseHardwareChanges } from "../lib/hardwareEvents.js";

function fmtTime(iso) {
  if (!iso) return "never";
  return new Date(iso).toLocaleString();
}

// The one real event-detail experience, shared by Device 360's Events/Hardware tabs and
// IncidentDetail's Evidence section - built once in Stage B, reused (not duplicated) here.
// Real fields only: id/timestamp/type/severity/device/message always exist; the
// Baseline->Current table only renders for hardware-tamper-detected events (parsed from that
// event's own real message); Related Incident only renders when a real sourceEventId match is
// passed in. No metadata/previous-new-state/hash fields are shown for other event types, since
// this backend doesn't expose any of that beyond what's parsed here - an absent field is simply
// not rendered, never faked as empty.
//
// onViewAlerts is optional: Device 360 passes a callback that switches its own Alerts tab
// in-place (preserving tab context); callers with no tab concept (IncidentDetail) get the default
// fallback below - a real navigation to the Alerts page filtered by this event's own severity,
// using the URL-state support already built into Alerts.jsx.
export default function EventDetailPanel({ event, relatedIncident = null, onClose, onViewAlerts }) {
  const hardwareChanges = event.eventType === "hardware-tamper-detected" ? parseHardwareChanges(event.message) : [];
  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000 }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="card" style={{ maxWidth: 520, width: "90%", maxHeight: "80vh", overflowY: "auto", padding: 20 }}>
        <div className="section-head" style={{ marginBottom: 12 }}>
          <div>
            <h3 className="section-title">Event Details</h3>
            <span className={`badge ${event.severity === "critical" ? "red" : event.severity === "warning" ? "amber" : "blue"}`} style={{ marginTop: 4, display: "inline-block" }}>{event.severity}</span>
          </div>
          <button className="icon-btn" onClick={onClose} aria-label="Close"><X size={16} /></button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 13, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span className="section-sub">Event ID</span><span className="mono truncate" style={{ maxWidth: 260 }} title={event.id}>{event.id}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span className="section-sub">Timestamp</span><span>{fmtTime(event.createdAt)}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span className="section-sub">Type</span><span className="mono">{event.eventType}</span></div>
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}><span className="section-sub">Device</span><span className="mono">{event.deviceId}</span></div>
          <div style={{ paddingTop: 4 }}>
            <span className="section-sub">Message</span>
            <p style={{ marginTop: 4, lineHeight: 1.5 }}>{event.message}</p>
          </div>
        </div>

        {hardwareChanges.length > 0 && (
          <div style={{ marginBottom: 16 }}>
            <h3 className="section-title" style={{ fontSize: 13, marginBottom: 8 }}>Hardware Changes</h3>
            <div className="table-scroll">
              <table className="data-table">
                <thead><tr><th>Component</th><th>Baseline</th><th>Current</th></tr></thead>
                <tbody>
                  {hardwareChanges.map((c, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 600 }}>{c.field}</td>
                      <td className="mono truncate" style={{ maxWidth: 140 }} title={c.baseline}>{c.baseline || "—"}</td>
                      <td className="mono truncate" style={{ maxWidth: 140 }} title={c.current}>{c.current || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {relatedIncident && (
            <Link to={`/incidents/${relatedIncident.id}`} className="btn" style={{ justifyContent: "space-between" }}>
              <span>Related Incident: {relatedIncident.title}</span> <ExternalLink size={13} />
            </Link>
          )}
          {event.severity !== "info" && (
            onViewAlerts ? (
              <button className="btn" style={{ justifyContent: "space-between" }} onClick={onViewAlerts}>
                <span>Also visible in Alerts</span> <ExternalLink size={13} />
              </button>
            ) : (
              <Link to={`/alerts?severity=${event.severity}`} className="btn" style={{ justifyContent: "space-between" }}>
                <span>Also visible in Alerts</span> <ExternalLink size={13} />
              </Link>
            )
          )}
        </div>
      </div>
    </div>
  );
}
