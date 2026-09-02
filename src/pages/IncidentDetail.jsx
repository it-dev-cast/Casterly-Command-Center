import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, ExternalLink, Cpu, MemoryStick, HardDrive, BatteryMedium, ShieldAlert, Lock } from "lucide-react";
import { useLiveData, healthFromLiveStatus, CPU_USAGE_THRESHOLDS, RAM_USAGE_THRESHOLDS, DISK_USAGE_THRESHOLDS } from "../context/LiveDataContext.jsx";
import { useRefetchOnEvent } from "../hooks/useRefetchOnEvent.js";
import { api } from "../lib/api.js";
import { parseHardwareChanges } from "../lib/hardwareEvents.js";
import { deviceHealthDisplay } from "../lib/deviceLiveness.js";
import StatCard from "../components/StatCard.jsx";
import EventDetailPanel from "../components/EventDetailPanel.jsx";
import { STATUS_LABELS, STATUS_TONE } from "./Incidents.jsx";

function fmtTime(iso) {
  if (!iso) return "—";
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
// Same real thresholds as Device 360's Live Telemetry tab - one tone convention, not a second one.
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

const STATUS_FLOW = [
  "open", "acknowledged", "investigating", "customer_contacted",
  "service_scheduled", "in_repair", "resolved", "closed",
];

export default function IncidentDetail() {
  const { id } = useParams();
  const { token, pushToast, devices, liveStatusByDevice, events, connected, offlineDeviceIds } = useLiveData();
  const [incident, setIncident] = useState(null);
  const [notes, setNotes] = useState([]);
  const [newNote, setNewNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [viewingEvent, setViewingEvent] = useState(null);

  async function load() {
    try {
      const data = await api.getIncidentDetail(token, id);
      setIncident(data.incident);
      setNotes(data.notes);
    } catch (e) {
      setError(e.message);
    }
  }

  useEffect(() => {
    if (token) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, id]);
  // Incident status/notes changes made by another admin/session have no dedicated SSE push (only
  // a generic "incident-status-changed" event on this incident's own device, same real signal
  // every other page's events array already carries) - this is the real bridge that keeps this
  // detail view from going stale for an entire session just because it was only ever fetched once
  // on mount/id change.
  useRefetchOnEvent(
    events,
    (e) => e.eventType === "incident-status-changed" && incident && e.deviceId === incident.deviceId,
    load,
  );

  async function handleStatusChange(status) {
    setBusy(true);
    try {
      await api.updateIncidentStatus(token, id, status);
      await load();
    } catch (e) {
      pushToast("error", "Unable to update incident. Please try again.", e.message);
    } finally {
      setBusy(false);
    }
  }

  async function handleAddNote(e) {
    e.preventDefault();
    if (!newNote.trim()) return;
    setBusy(true);
    try {
      await api.addIncidentNote(token, id, newNote.trim());
      setNewNote("");
      await load();
    } catch (e) {
      pushToast("error", "Add note failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  if (error) {
    return (
      <div>
        <Link to="/incidents" className="btn" style={{ display: "inline-flex", marginBottom: 16 }}>
          <ArrowLeft size={14} /> Back to Incidents
        </Link>
        <div className="card"><p className="empty-note" style={{ color: "var(--red)" }}>Couldn't load incident: {error}</p></div>
      </div>
    );
  }
  if (!incident) {
    return (
      <div>
        <Link to="/incidents" className="btn" style={{ display: "inline-flex", marginBottom: 16 }}>
          <ArrowLeft size={14} /> Back to Incidents
        </Link>
        <div className="card"><p className="empty-note">Loading incident…</p></div>
      </div>
    );
  }

  const device = devices.find((d) => d.id === incident.deviceId);
  const liveStatus = liveStatusByDevice[incident.deviceId];
  // Real per-device liveness, computed once centrally in LiveDataContext - takes priority over
  // the tab-wide SSE `connected` flag when they disagree, so this card can't show "Live" for a
  // device that's actually gone offline just because this browser tab's own connection happens
  // to be fine.
  const deviceIsOffline = offlineDeviceIds.has(incident.deviceId);
  // Gated on that same liveness signal - a stale device's frozen last reading displays as
  // "stale," not a live-looking Critical/Warning state.
  const health = deviceHealthDisplay(healthFromLiveStatus(liveStatus), deviceIsOffline);

  // Real Evidence: only ever resolved from this device's own real sourceEventId - never a
  // fabricated relationship. events is the tenant-wide live buffer (last ~100-200), so an old
  // incident's source event may genuinely not be loaded - that's shown honestly, not hidden.
  const sourceEvent = incident.sourceEventId ? events.find((e) => e.id === incident.sourceEventId) : null;
  const isHardwareEvidence = sourceEvent?.eventType === "hardware-tamper-detected";
  const hardwareChanges = isHardwareEvidence ? parseHardwareChanges(sourceEvent.message) : [];

  // Real broader context beyond the single source event - same tenant-wide events buffer this
  // whole app already shares (no new fetch), client-filtered to this incident's device and capped
  // for readability. Explicitly NOT claimed as complete history, since the underlying buffer
  // itself is windowed (same disclosure every other page's event list already uses).
  const deviceEvents = events.filter((e) => e.deviceId === incident.deviceId).slice(0, 8);

  // Real chronological timeline - only transitions this backend actually timestamps
  // (createdAt/resolvedAt/closedAt on the incident, real note timestamps, and the source event's
  // own createdAt when resolvable). No fabricated "acknowledged at"/"status changed at" entries,
  // since intermediate status transitions have no timestamp field of their own in this backend.
  const timelineItems = [];
  if (sourceEvent) timelineItems.push({ ts: sourceEvent.createdAt, label: "Event detected", detail: sourceEvent.message });
  timelineItems.push({ ts: incident.createdAt, label: "Incident created", detail: incident.title });
  notes.forEach((n) => timelineItems.push({ ts: n.createdAt, label: "Note added", detail: n.note }));
  if (incident.resolvedAt) timelineItems.push({ ts: incident.resolvedAt, label: "Incident resolved", detail: null });
  if (incident.closedAt) timelineItems.push({ ts: incident.closedAt, label: "Incident closed", detail: null });
  timelineItems.sort((a, b) => new Date(a.ts) - new Date(b.ts));

  return (
    <div>
      <Link to="/incidents" className="btn" style={{ display: "inline-flex", marginBottom: 16 }}>
        <ArrowLeft size={14} /> Back to Incidents
      </Link>

      <div className="section-head" style={{ marginBottom: 4 }}>
        <div>
          <h1 className="page-title">{incident.title}</h1>
          <p className="page-sub">
            <Link to={`/endpoints/${incident.deviceId}`} className="mono" style={{ color: "var(--accent)" }}>{incident.deviceId}</Link> · Opened {fmtTime(incident.createdAt)}
          </p>
        </div>
        <Link to={`/endpoints/${incident.deviceId}`} className="btn primary">Open Device 360</Link>
      </div>

      <div style={{ margin: "14px 0 20px" }}>
        <span className={`badge lg ${STATUS_TONE[incident.status]}`}>{STATUS_LABELS[incident.status]}</span>
        <span className={`badge ${incident.severity === "critical" ? "red" : "amber"}`} style={{ marginLeft: 8 }}>{incident.severity}</span>
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20, gap: 16 }}>
        <div className="card">
          <h3 className="section-title" style={{ marginBottom: 12 }}>Affected Device</h3>
          {device ? (
            <div style={{ fontSize: 13, lineHeight: 2 }}>
              <div><span style={{ color: "var(--text-faint)" }}>Hostname: </span>{device.hostname}</div>
              <div><span style={{ color: "var(--text-faint)" }}>Status: </span><span className={`badge ${device.status === "active" ? "green" : "slate"}`}>{device.status}</span></div>
              <div><span style={{ color: "var(--text-faint)" }}>Health: </span><span className={`badge ${health === "healthy" ? "green" : health === "warning" ? "amber" : health === "critical" ? "red" : "gray"}`}>{health === "unknown" ? "no data" : health === "stale" ? "not reporting" : health}</span></div>
              <div><span style={{ color: "var(--text-faint)" }}>Connection: </span><span style={{ color: deviceIsOffline ? "var(--text-faint)" : connected ? "var(--green)" : "var(--amber)" }}>{deviceIsOffline ? "Offline" : connected ? "Live" : "Reconnecting"}</span></div>
              <div><span style={{ color: "var(--text-faint)" }}>Last Seen: </span>{timeAgo(device.lastSeenAt)}</div>
            </div>
          ) : (
            <div className="empty-note">Device details not currently loaded.</div>
          )}
        </div>

        <div className="card">
          <h3 className="section-title" style={{ marginBottom: 12 }}>Details</h3>
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <div><span style={{ color: "var(--text-faint)" }}>Incident ID: </span><span className="mono">{incident.id}</span></div>
            <div><span style={{ color: "var(--text-faint)" }}>Assigned to: </span>{incident.assignedTo || "Unassigned"}</div>
            <div><span style={{ color: "var(--text-faint)" }}>Last updated: </span>{fmtTime(incident.updatedAt)}</div>
            <div><span style={{ color: "var(--text-faint)" }}>Source event: </span>{incident.sourceEventId ? <span className="mono">{incident.sourceEventId}</span> : "— (opened directly)"}</div>
          </div>
          {incident.severity && (
            <Link to={`/alerts?severity=${incident.severity}`} className="btn" style={{ marginTop: 10, width: "100%", justifyContent: "space-between" }}>
              <span>View {incident.severity} alerts</span> <ExternalLink size={13} />
            </Link>
          )}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Evidence</h3>
        {!incident.sourceEventId && <div className="empty-note">No related events found.</div>}
        {incident.sourceEventId && !sourceEvent && (
          <div className="empty-note">Source event <span className="mono">{incident.sourceEventId}</span> exists but isn't currently loaded in this session.</div>
        )}
        {sourceEvent && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div>
                <span className={`badge ${sourceEvent.severity === "critical" ? "red" : sourceEvent.severity === "warning" ? "amber" : "blue"}`}>{sourceEvent.severity}</span>
                <span style={{ marginLeft: 8, fontSize: 12, color: "var(--text-faint)" }}>{sourceEvent.eventType} · {fmtTime(sourceEvent.createdAt)}</span>
                <p style={{ marginTop: 6, fontSize: 13, lineHeight: 1.5 }}>{sourceEvent.message}</p>
              </div>
              <button className="btn" onClick={() => setViewingEvent(sourceEvent)} style={{ flexShrink: 0 }}>View Event</button>
            </div>

            {isHardwareEvidence && hardwareChanges.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
                  <ShieldAlert size={15} color="var(--amber)" />
                  <span style={{ fontWeight: 700, fontSize: 13 }}>Hardware Change Detected</span>
                </div>
                <div className="table-scroll">
                  <table className="data-table">
                    <thead><tr><th>Component</th><th>Baseline</th><th>Current</th></tr></thead>
                    <tbody>
                      {hardwareChanges.map((c, i) => (
                        <tr key={i}>
                          <td style={{ fontWeight: 600 }}>{c.field}</td>
                          <td className="mono truncate" style={{ maxWidth: 160 }} title={c.baseline}>{c.baseline || "—"}</td>
                          <td className="mono truncate" style={{ maxWidth: 160 }} title={c.current}>{c.current || "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Event History</h3>
        <p className="section-sub" style={{ marginBottom: 10 }}>This device's events within the current event window (most recent first, up to 200 tenant-wide) — click a row for details</p>
        {deviceEvents.length === 0 ? (
          <div className="empty-note">No events recorded for this device in the current window.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Severity</th><th>Type</th><th>Message</th><th>When</th></tr></thead>
              <tbody>
                {deviceEvents.map((e) => (
                  <tr key={e.id} onClick={() => setViewingEvent(e)} style={{ cursor: "pointer" }}>
                    <td><span className={`badge ${e.severity === "critical" ? "red" : e.severity === "warning" ? "amber" : "blue"}`}>{e.severity}</span></td>
                    <td>{e.eventType}</td>
                    <td className="truncate" style={{ maxWidth: 320 }} title={e.message}>{e.message}</td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(e.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Current Device State</h3>
        <p className="section-sub" style={{ marginBottom: 12 }}>Real-time telemetry, as of right now — not a snapshot from when this incident occurred</p>
        {liveStatus ? (
          <div className="grid grid-4">
            <StatCard icon={Cpu} tone={deviceIsOffline ? "gray" : usageTone(liveStatus?.cpuPct, CPU_USAGE_THRESHOLDS)} value={liveStatus?.cpuPct != null ? `${liveStatus.cpuPct}%` : "—"} label="CPU" live={connected && !deviceIsOffline} />
            <StatCard icon={MemoryStick} tone={deviceIsOffline ? "gray" : usageTone(liveStatus?.ramPct, RAM_USAGE_THRESHOLDS)} value={liveStatus?.ramPct != null ? `${liveStatus.ramPct}%` : "—"} label="RAM" live={connected && !deviceIsOffline} />
            <StatCard icon={HardDrive} tone={deviceIsOffline ? "gray" : usageTone(liveStatus?.diskPct, DISK_USAGE_THRESHOLDS)} value={liveStatus?.diskPct != null ? `${liveStatus.diskPct}%` : "—"} label="Disk" live={connected && !deviceIsOffline} />
            <StatCard icon={BatteryMedium} tone={deviceIsOffline ? "gray" : batteryTone(liveStatus?.batteryPct)} value={liveStatus?.batteryPct != null ? `${liveStatus.batteryPct}%` : "—"} label="Battery Charge" live={connected && !deviceIsOffline} />
          </div>
        ) : (
          <div className="empty-note">No live telemetry currently available for this device.</div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Timeline</h3>
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {timelineItems.map((t, i) => (
            <div key={i} style={{ display: "flex", gap: 12 }}>
              <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", flexShrink: 0, width: 140 }}>{fmtTime(t.ts)}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{t.label}</div>
                {t.detail && <div style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{t.detail}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Lifecycle Context</h3>
        {device ? (
          <div style={{ fontSize: 13, lineHeight: 2 }}>
            <div>
              <span style={{ color: "var(--text-faint)" }}>Hardware baseline: </span>
              {device.fingerprintLockedAt
                ? <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}><Lock size={12} /> Locked at {fmtTime(device.fingerprintLockedAt)}</span>
                : "Not yet locked"}
            </div>
            <Link to="/lifecycle" style={{ color: "var(--accent)", fontSize: 12.5 }}>View fleet Lifecycle & Licensing →</Link>
          </div>
        ) : (
          <div className="empty-note">Lifecycle information unavailable.</div>
        )}
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Actions</h3>
        <p className="section-sub" style={{ marginBottom: 10 }}>This incident's real, currently supported state transitions</p>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {STATUS_FLOW.map((s) => (
            <button
              key={s}
              className={`pill-select ${s === incident.status ? "active" : ""}`}
              disabled={busy || s === incident.status}
              style={{ opacity: busy ? 0.6 : 1 }}
              onClick={() => handleStatusChange(s)}
            >
              {STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title" style={{ marginBottom: 12 }}>Resolution</h3>
        <div style={{ fontSize: 13, lineHeight: 2 }}>
          <div><span style={{ color: "var(--text-faint)" }}>Status: </span><span className={`badge ${STATUS_TONE[incident.status]}`}>{STATUS_LABELS[incident.status]}</span></div>
          <div><span style={{ color: "var(--text-faint)" }}>Resolved: </span>{incident.resolvedAt ? fmtTime(incident.resolvedAt) : "Not yet resolved"}</div>
          <div><span style={{ color: "var(--text-faint)" }}>Closed: </span>{incident.closedAt ? fmtTime(incident.closedAt) : "Not yet closed"}</div>
        </div>
      </div>

      <div className="card">
        <h3 className="section-title" style={{ marginBottom: 12 }}>Notes & History</h3>
        <form onSubmit={handleAddNote} style={{ display: "flex", gap: 8, marginBottom: 18 }}>
          <input
            className="search-box"
            style={{ flex: 1 }}
            placeholder="Add a note — customer contacted, service scheduled, what was found..."
            value={newNote}
            onChange={(e) => setNewNote(e.target.value)}
          />
          <button className="btn primary" type="submit" disabled={busy || !newNote.trim()}>Add Note</button>
        </form>

        {notes.length === 0 && <div className="empty-note">No notes yet.</div>}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {notes.map((n) => (
            <div key={n.id} style={{ padding: "10px 14px", background: "var(--bg-panel-2)", borderRadius: "var(--radius)", border: "1px solid var(--border-soft)" }}>
              <div style={{ fontSize: 13 }}>{n.note}</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>{fmtTime(n.createdAt)}</div>
            </div>
          ))}
        </div>
      </div>

      {viewingEvent && <EventDetailPanel event={viewingEvent} onClose={() => setViewingEvent(null)} />}
    </div>
  );
}
