import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  Zap, Info, Monitor, CheckCircle2, AlertTriangle, XCircle, WifiOff,
  ArrowRight, ClipboardCheck, ShieldCheck, ShieldAlert, PhoneCall,
} from "lucide-react";
import EventDetailPanel from "../components/EventDetailPanel.jsx";
import GlanceCell from "../components/GlanceCell.jsx";
import { useLiveData, healthFromLiveStatus, getUsageColor, CPU_USAGE_THRESHOLDS, RAM_USAGE_THRESHOLDS, DISK_USAGE_THRESHOLDS } from "../context/LiveDataContext.jsx";
import { useRefetchOnEvent, isIncidentEvent } from "../hooks/useRefetchOnEvent.js";
import { api, TENANT_ID } from "../lib/api.js";
import { deviceHealthDisplay } from "../lib/deviceLiveness.js";
import { latestBatteryHealthPct, batteryHealthColor } from "../lib/batteryHealth.js";
import { liveBatteryHealthPct, formatEventLine } from "../lib/liveDetail.js";
import { OPEN_STATUSES } from "./Incidents.jsx";

function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function formatDuration(ms) {
  const hours = ms / (1000 * 60 * 60);
  if (hours < 1) return `${Math.max(1, Math.round(ms / (1000 * 60)))}m`;
  if (hours < 48) return `${hours.toFixed(1)}h`;
  return `${(hours / 24).toFixed(1)}d`;
}

function labelEventType(type) {
  if (!type) return "Event";
  return type.replace(/[-_]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// Same threshold order Endpoints.jsx currentSignal uses — the crossed limit, not a new metric.
function liveSignal(status) {
  if (!status) return { label: "No live reading yet", tone: "gray" };
  const checks = [
    { label: "CPU", value: status.cpuPct, thresholds: CPU_USAGE_THRESHOLDS },
    { label: "RAM", value: status.ramPct, thresholds: RAM_USAGE_THRESHOLDS },
    { label: "Disk", value: status.diskPct, thresholds: DISK_USAGE_THRESHOLDS },
  ];
  for (const c of checks) {
    if (c.value != null && c.value > c.thresholds.critical) return { label: `${c.label} ${c.value}%`, tone: "red", metric: c.label, value: c.value };
  }
  for (const c of checks) {
    if (c.value != null && c.value > c.thresholds.warning) return { label: `${c.label} ${c.value}%`, tone: "amber", metric: c.label, value: c.value };
  }
  if (status.batteryPct != null && status.batteryPct < 20) return { label: `Battery ${status.batteryPct}%`, tone: "red", metric: "Battery", value: status.batteryPct };
  if (status.batteryPct != null && status.batteryPct <= 50) return { label: `Battery ${status.batteryPct}%`, tone: "amber", metric: "Battery", value: status.batteryPct };
  return { label: "No active issue", tone: "gray" };
}

function fmtPct(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

function usageHint(value, thresholds) {
  if (value == null) return "No data";
  if (value > thresholds.critical) return "Critical";
  if (value > thresholds.warning) return "High";
  return "OK";
}

function batteryHint(value) {
  if (value == null) return "No data";
  if (value <= 40) return "Replace soon";
  if (value <= 80) return "Worn";
  return "OK";
}

function issueLine(status, batteryHealthPct) {
  const signal = liveSignal(status);
  if (signal.metric === "Disk" && signal.value != null) {
    return signal.value >= 95 ? `Disk is full — ${fmtPct(signal.value)}% used` : `Disk is high — ${fmtPct(signal.value)}% used`;
  }
  if (signal.metric === "CPU" && signal.value != null) return `CPU is high — ${fmtPct(signal.value)}%`;
  if (signal.metric === "RAM" && signal.value != null) return `Memory is high — ${fmtPct(signal.value)}%`;
  if (signal.metric === "Battery" && signal.value != null) return `Charge is low — ${fmtPct(signal.value)}%`;
  if (batteryHealthPct != null && batteryHealthPct <= 80) return `Battery health is low — ${fmtPct(batteryHealthPct)}%`;
  return null;
}

function MetricTile({ label, value, color, hint }) {
  const pct = fmtPct(value);
  const bar = pct == null ? 0 : Math.max(0, Math.min(100, pct));
  return (
    <div className="sys-metric">
      <div className="sys-metric-lab">{label}</div>
      <div className="sys-metric-val" style={{ color }}>{pct == null ? "—" : `${pct}%`}</div>
      <div className="sys-metric-track">
        <div className="sys-metric-fill" style={{ width: `${bar}%`, background: color }} />
      </div>
      <div className="sys-metric-hint" style={{ color }}>{hint}</div>
    </div>
  );
}

function DeviceFocus({ d, recent, batteryHealthPct }) {
  // Stale (offline, health already downgraded to "stale" by deviceHealthDisplay before this
  // component ever sees it) means the numbers below are a last-known reading, not a current one -
  // every color/hint on this card is neutralized to a plain faint gray rather than still coloring
  // a frozen 41-hour-old 96% disk reading red as if it were happening right now.
  const isStale = d.health === "stale";
  const faintColor = "var(--text-faint)";
  const healthColor = isStale ? faintColor : batteryHealthColor(batteryHealthPct);
  const model = d.status_?.detail?.model;
  const why = isStale ? `Not reporting — last seen ${timeAgo(d.lastSeenAt)}` : issueLine(d.status_, batteryHealthPct);
  const cpu = d.status_?.cpuPct;
  const ram = d.status_?.ramPct;
  const disk = d.status_?.diskPct;
  return (
    <Link
      to={`/endpoints/${d.id}`}
      className={`sys-card ${d.health}${recent ? " flash" : ""}`}
      title={`${d.hostname} · ${d.id}`}
    >
      <div className="sys-card-top">
        <div className="sys-card-id">
          <div className="sys-card-name truncate">{d.hostname}</div>
          <div className="sys-card-meta truncate">
            {[model, timeAgo(d.lastSeenAt)].filter(Boolean).join(" · ")}
          </div>
        </div>
        <span className={`badge ${d.health === "warning" ? "amber" : d.health === "critical" ? "red" : d.health === "healthy" ? "green" : "gray"}`}>
          {d.health === "unknown" ? "no data" : d.health === "stale" ? "not reporting" : d.health}
        </span>
      </div>
      {why && <p className="sys-card-why">{why}</p>}
      <div className="sys-metrics">
        <MetricTile label="CPU" value={cpu} color={isStale ? faintColor : getUsageColor(cpu, CPU_USAGE_THRESHOLDS)} hint={isStale ? "Stale" : usageHint(cpu, CPU_USAGE_THRESHOLDS)} />
        <MetricTile label="Memory" value={ram} color={isStale ? faintColor : getUsageColor(ram, RAM_USAGE_THRESHOLDS)} hint={isStale ? "Stale" : usageHint(ram, RAM_USAGE_THRESHOLDS)} />
        <MetricTile label="Disk" value={disk} color={isStale ? faintColor : getUsageColor(disk, DISK_USAGE_THRESHOLDS)} hint={isStale ? "Stale" : usageHint(disk, DISK_USAGE_THRESHOLDS)} />
        <MetricTile label="Battery health" value={batteryHealthPct} color={healthColor} hint={isStale ? "Stale" : batteryHint(batteryHealthPct)} />
      </div>
      <span className="sys-card-go">Open this device <ArrowRight size={14} /></span>
    </Link>
  );
}

export default function Dashboard() {
  const { devices, liveStatusByDevice, events, recentDeviceIds, token, connected, offlineDeviceIds, offlineDevices } = useLiveData();
  const navigate = useNavigate();

  const [incidents, setIncidents] = useState([]);
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [batteryHealthById, setBatteryHealthById] = useState({});
  const [remoteSessions, setRemoteSessions] = useState([]);
  function refreshIncidents() {
    if (!token) return;
    api.listIncidents(token).then(setIncidents).catch(() => {});
  }
  useEffect(refreshIncidents, [token]);
  // Incidents have no dedicated SSE push (see useRefetchOnEvent's own comment) - this is the real
  // bridge that keeps the headline/jump-strip incident counts from going stale for an entire
  // session just because they were only ever fetched once on mount.
  useRefetchOnEvent(events, isIncidentEvent, refreshIncidents);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    function tick() {
      api.listRemoteSessions(token).then((list) => { if (!cancelled) setRemoteSessions(Array.isArray(list) ? list : []); }).catch(() => {});
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);
  useEffect(() => {
    if (!token) return;
    const active = devices.filter((d) => d.status === "active");
    if (active.length === 0) { setBatteryHealthById({}); return; }
    Promise.all(active.map((d) =>
      api.getDeviceMetricSnapshots(token, d.id)
        .then((snaps) => [d.id, latestBatteryHealthPct(snaps)])
        .catch(() => [d.id, null])
    )).then((pairs) => setBatteryHealthById(Object.fromEntries(pairs)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, devices.length]);
  function relatedIncidentFor(event) {
    return incidents.find((i) => i.sourceEventId === event.id) || null;
  }
  const resolvedWithTimes = incidents.filter((i) => i.status === "resolved" && i.createdAt && i.resolvedAt);
  const avgResolutionMs = resolvedWithTimes.length
    ? resolvedWithTimes.reduce((sum, i) => sum + (new Date(i.resolvedAt) - new Date(i.createdAt)), 0) / resolvedWithTimes.length
    : null;
  const openIncidentsCount = incidents.filter((i) => OPEN_STATUSES.includes(i.status)).length;

  const activeDevices = devices.filter((d) => d.status === "active");
  const withHealth = activeDevices.map((d) => ({
    ...d,
    status_: liveStatusByDevice[d.id],
    health: deviceHealthDisplay(healthFromLiveStatus(liveStatusByDevice[d.id]), offlineDeviceIds.has(d.id)),
  }));

  const healthy = withHealth.filter((d) => d.health === "healthy").length;
  const warning = withHealth.filter((d) => d.health === "warning").length;
  const critical = withHealth.filter((d) => d.health === "critical").length;
  const needsAttention = withHealth.filter((d) => d.health !== "healthy");
  const hardwareAffectedCount = new Set(events.filter((e) => e.eventType === "hardware-tamper-detected").map((e) => e.deviceId)).size;
  const waitingRemote = remoteSessions.filter((s) => (s.peerCount ?? 0) < 2);

  const hostnameById = useMemo(
    () => Object.fromEntries(devices.map((d) => [d.id, d.hostname])),
    [devices],
  );
  const recentEvents = events.slice(0, 10);
  const deviceCount = withHealth.length;

  const headlineTone = deviceCount === 0
    ? "empty"
    : critical > 0
      ? "critical"
      : needsAttention.length > 0
        ? "warning"
        : "healthy";
  const headline = deviceCount === 0
    ? "No devices reporting yet"
    : needsAttention.length === 1
      ? "1 device needs attention"
      : needsAttention.length > 1
        ? `${needsAttention.length} devices need attention`
        : "Fleet is healthy";
  // stale sorts after real warning/critical (an unconfirmed old reading is worth surfacing, but
  // below devices actively reporting a real current problem) and above unknown/healthy.
  const HEALTH_ORDER = { critical: 0, warning: 1, stale: 2, unknown: 3, healthy: 4 };
  const fleetCards = [...withHealth].sort((a, b) => (HEALTH_ORDER[a.health] ?? 9) - (HEALTH_ORDER[b.health] ?? 9));
  const DASH_CARD_LIMIT = 8;
  const shownCards = fleetCards.slice(0, DASH_CARD_LIMIT);
  const hiddenCards = fleetCards.length - shownCards.length;
  const worst = fleetCards.find((d) => d.health !== "healthy");
  // A stale device's last reading is exactly what shouldn't drive this headline's "why" text -
  // "not reporting" is the honest reason, not whatever it last measured before it went quiet.
  const attentionWhy = worst
    ? worst.health === "stale"
      ? `Not reporting — last seen ${timeAgo(worst.lastSeenAt)}`
      : issueLine(worst.status_, liveBatteryHealthPct(worst.status_, batteryHealthById[worst.id]))
    : null;

  return (
    <div className="dash-page">
      <section className={`cmd-hero ${headlineTone}`}>
        <div className="cmd-hero-glow" aria-hidden="true" />
        <div className="cmd-hero-bar">
          <p className="dash-kicker">Pulse Command · {TENANT_ID}</p>
          <div className="cmd-hero-actions">
            <span className={`live-chip ${connected ? "on" : "off"}`}>
              <span className="live-chip-dot" />
              {connected ? "Live" : "Reconnecting"}
            </span>
            <Link to="/action-center" className="btn primary">
              <Zap size={14} /> Action Center
            </Link>
          </div>
        </div>
        <h1 className={`page-title dash-headline ${headlineTone}`}>{headline}</h1>
        {worst && (
          <p className="dash-why">
            {needsAttention.length > 1
              ? `${needsAttention.length} of ${deviceCount} · ${worst.hostname}${attentionWhy ? ` · ${attentionWhy}` : ""}`
              : `${worst.hostname}${attentionWhy ? ` · ${attentionWhy}` : ""}`}
          </p>
        )}
        <p className="dash-sub-meta">
          {activeDevices.length} endpoint{activeDevices.length === 1 ? "" : "s"} reporting
          {offlineDevices.length > 0 ? ` · ${offlineDevices.length} not reporting` : ""}
        </p>

        <div className="glance-strip">
          <GlanceCell to="/endpoints" tone="blue" icon={Monitor} value={activeDevices.length} label="Devices" meta="In this fleet" />
          <GlanceCell to="/endpoints?health=healthy" tone="green" icon={CheckCircle2} value={healthy} label="Healthy" meta={healthy > 0 ? "All clear" : undefined} />
          <GlanceCell to="/endpoints?health=warning" tone="amber" icon={AlertTriangle} value={warning} label="Warning" meta={warning > 0 ? "Watch these" : undefined} />
          <GlanceCell to="/endpoints?health=critical" tone="red" icon={XCircle} value={critical} label="Critical" meta={critical > 0 ? "Act now" : undefined} />
          <GlanceCell to="/endpoints?connection=offline" tone="slate" icon={WifiOff} value={offlineDevices.length} label="Offline" meta="Not reporting" />
        </div>

        {deviceCount > 0 ? (
          <div className="cmd-focus-block">
            <div className="cmd-focus-caption">
              {deviceCount} endpoint{deviceCount === 1 ? "" : "s"}
              {needsAttention.length > 0 ? ` · ${needsAttention.length} need a look` : " · all clear"}
            </div>
            <div className={`sys-card-grid${shownCards.length === 1 ? " one" : ""}`}>
              {shownCards.map((d) => (
                <DeviceFocus key={d.id} d={d} recent={recentDeviceIds.has(d.id)} batteryHealthPct={liveBatteryHealthPct(d.status_, batteryHealthById[d.id])} />
              ))}
            </div>
            {hiddenCards > 0 && (
              <Link to="/endpoints" className="sys-card-more">
                View all {deviceCount} on Endpoints →
              </Link>
            )}
          </div>
        ) : (
          <div className="empty-note">No live telemetry yet.</div>
        )}
      </section>

      {waitingRemote.length > 0 && (
        <Link
          to={`/remote-assist?device=${encodeURIComponent(waitingRemote[0].deviceId)}`}
          className="remote-wait-banner"
        >
          <PhoneCall size={16} />
          <span>
            {waitingRemote.length === 1
              ? `${waitingRemote[0].hostname || "An endpoint"} requested ${waitingRemote[0].mode === "chat" ? "text chat" : waitingRemote[0].mode === "voice" ? "voice" : "screen share"}`
              : `${waitingRemote.length} remote assist requests waiting`}
          </span>
          <span className="remote-wait-go">Join →</span>
        </Link>
      )}

      <div className="jump-strip">
        <Link to="/incidents?status=open" className={`jump-tile ${openIncidentsCount > 0 ? "hot" : ""}`}>
          <ClipboardCheck size={18} />
          <div>
            <div className="jump-value">{openIncidentsCount}</div>
            <div className="jump-label">
              {avgResolutionMs != null ? `Open incidents · avg ${formatDuration(avgResolutionMs)}` : "Open incidents"}
            </div>
          </div>
          <ArrowRight size={14} className="jump-arrow" />
        </Link>
        <Link to="/approvals" className="jump-tile">
          <ShieldCheck size={18} />
          <div>
            <div className="jump-value jump-value-text">Review</div>
            <div className="jump-label">Pending approvals</div>
          </div>
          <ArrowRight size={14} className="jump-arrow" />
        </Link>
        <Link to="/hardware-integrity" className={`jump-tile ${hardwareAffectedCount > 0 ? "hot" : ""}`}>
          <ShieldAlert size={18} />
          <div>
            <div className="jump-value">{hardwareAffectedCount}</div>
            <div className="jump-label">Hardware changes</div>
          </div>
          <ArrowRight size={14} className="jump-arrow" />
        </Link>
      </div>

      <div className="card event-card">
        <div className="section-head">
          <div>
            <h2 className="section-title">What Changed</h2>
            <p className="section-sub">
              Latest fleet events
              <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2, marginLeft: 6 }} title="Pushed instantly over SSE, not polled. Shows the current event window — up to 200 most recent events tenant-wide." />
            </p>
          </div>
        </div>
        {recentEvents.length === 0 && <div className="empty-note">No events yet.</div>}
        <div className="event-feed">
          {recentEvents.map((event) => {
            const host = hostnameById[event.deviceId] || event.deviceId;
            const sev = event.severity === "critical" ? "critical" : event.severity === "warning" ? "warning" : "info";
            return (
              <button
                key={event.id}
                type="button"
                className="event-feed-row"
                onClick={() => {
                  if (event.eventType === "remote-assist-requested") {
                    navigate(`/remote-assist?device=${encodeURIComponent(event.deviceId)}`);
                    return;
                  }
                  setSelectedEvent(event);
                }}
              >
                <span className={`event-feed-dot ${sev}`} aria-hidden="true" />
                <span className="event-feed-body">
                  <span className="event-feed-type">{labelEventType(event.eventType)}</span>
                  <span className="event-feed-msg truncate" title={event.message}>{formatEventLine(event.message)}</span>
                </span>
                <span className="event-feed-aside">
                  <span className="event-feed-host truncate" title={host}>{host}</span>
                  <span className="mono event-feed-when">{timeAgo(event.createdAt)}</span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {selectedEvent && (
        <EventDetailPanel
          event={selectedEvent}
          relatedIncident={relatedIncidentFor(selectedEvent)}
          onClose={() => setSelectedEvent(null)}
        />
      )}
    </div>
  );
}
