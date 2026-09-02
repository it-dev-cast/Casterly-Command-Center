import { Link } from "react-router-dom";
import { Activity, CheckCircle2, AlertTriangle, ShieldAlert, HelpCircle, Cpu, MemoryStick, HardDrive, BatteryMedium, Server, Radio, Waves, RefreshCw } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import { useLiveData, healthFromLiveStatus, CPU_USAGE_THRESHOLDS, RAM_USAGE_THRESHOLDS, DISK_USAGE_THRESHOLDS } from "../context/LiveDataContext.jsx";
import { useApiHealth } from "../hooks/useApiHealth.js";
import { deviceHealthDisplay } from "../lib/deviceLiveness.js";

function timeAgo(iso) {
  if (!iso) return "never";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
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
// Explicit lookup, not a dynamic `var(--${tone})` string - there's no literal --gray custom
// property in index.css (the "gray" tone is realized via --text-faint everywhere else in this
// app), so building the var name from the tone string would silently break for that one case.
const TONE_COLOR = { green: "var(--green)", amber: "var(--amber)", red: "var(--red)", gray: "var(--text-faint)" };

// Below this count, a full-width table shell around 1-2 rows reads as sparse/unfinished rather
// than compact - the exact same real problem Dashboard's Fleet Pulse hero had at low device
// counts, fixed there with a dedicated compact layout rather than a scaled-down table. Same fix,
// same threshold, applied here: real per-device cards instead of a mostly-empty table.
const COMPACT_THRESHOLD = 3;

export default function Infrastructure() {
  const { devices, liveStatusByDevice, events, connected, offlineDeviceIds } = useLiveData();
  const { apiHealth, checking: checkingHealth, checkHealth } = useApiHealth();

  // Real, derived from the same event buffer every other page already loads (no new fetch) -
  // events arrives newest-first, so the first entry's timestamp is genuinely the most recent
  // event this backend has ingested for this tenant, from any device.
  const lastEventAt = events[0]?.createdAt;

  const active = devices.filter((d) => d.status === "active");
  const withHealth = active.map((d) => ({
    ...d,
    liveStatus: liveStatusByDevice[d.id],
    health: deviceHealthDisplay(healthFromLiveStatus(liveStatusByDevice[d.id]), offlineDeviceIds.has(d.id)),
    offline: offlineDeviceIds.has(d.id),
  }));
  const healthy = withHealth.filter((d) => d.health === "healthy").length;
  const warning = withHealth.filter((d) => d.health === "warning").length;
  const critical = withHealth.filter((d) => d.health === "critical").length;
  const unknown = withHealth.filter((d) => d.health === "unknown").length;
  const isCompact = withHealth.length > 0 && withHealth.length <= COMPACT_THRESHOLD;

  return (
    <div>
      <h1 className="page-title">Infrastructure</h1>
      <p className="page-sub">Active enrolled endpoints — not fleet-wide layers, since those aren't monitored yet</p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard icon={Activity} tone="blue" value={active.length} label="Active Endpoints" live />
        <StatCard icon={CheckCircle2} tone="green" value={healthy} label="Healthy" live />
        <StatCard icon={AlertTriangle} tone="amber" value={warning} label="Warning" live />
        <StatCard icon={ShieldAlert} tone="red" value={critical} label="Critical" live />
        <StatCard icon={HelpCircle} tone="gray" value={unknown} label="No Data Yet" live />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-head">
          <div>
            <h3 className="section-title">Platform Health</h3>
            <p className="section-sub">Real backend/platform signals — not fleet devices, the Command Center service itself</p>
          </div>
          <button className="btn" onClick={checkHealth} disabled={checkingHealth}>
            <RefreshCw size={13} style={{ animation: checkingHealth ? "spin 0.8s linear infinite" : "none" }} /> Recheck
          </button>
        </div>
        <div className="grid grid-3" style={{ gap: 16, marginTop: 8 }}>
          <div className="card" style={{ background: "var(--bg-panel-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Server size={15} color={checkingHealth ? "var(--text-faint)" : apiHealth?.ok ? "var(--green)" : "var(--red)"} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>API / Database</span>
            </div>
            {checkingHealth ? (
              <div className="empty-note" style={{ padding: 0 }}>Checking…</div>
            ) : (
              <>
                <span className={`badge ${apiHealth?.ok ? "green" : "red"}`}>{apiHealth?.ok ? "Healthy" : "Unreachable"}</span>
                {apiHealth?.ok && apiHealth?.latencyMs != null && (
                  <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Responded in {apiHealth.latencyMs}ms — real GET /v1/health, DB-backed</div>
                )}
              </>
            )}
          </div>

          <div className="card" style={{ background: "var(--bg-panel-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Radio size={15} color={connected ? "var(--green)" : "var(--amber)"} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>Live Connection (SSE)</span>
            </div>
            <span className={`badge ${connected ? "green" : "amber"}`}>{connected ? "Connected" : "Reconnecting"}</span>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Real-time push channel every other live view on this dashboard depends on</div>
          </div>

          <div className="card" style={{ background: "var(--bg-panel-2)" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <Waves size={15} color={lastEventAt ? "var(--green)" : "var(--text-faint)"} />
              <span style={{ fontWeight: 700, fontSize: 13 }}>Event Pipeline</span>
            </div>
            {lastEventAt ? (
              <>
                <span className="badge green">Receiving</span>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Last real event ingested {timeAgo(lastEventAt)}</div>
              </>
            ) : (
              <div className="empty-note" style={{ padding: 0 }}>No events ingested yet.</div>
            )}
          </div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title">Active Endpoints</h3>
        <p className="section-sub">Real devices only — no simulated or placeholder entries</p>

        {withHealth.length === 0 && <div className="empty-note">No active devices yet.</div>}

        {isCompact ? (
          <div className="grid grid-3" style={{ gap: 16, marginTop: 8 }}>
            {withHealth.map((d) => (
              <Link key={d.id} to={`/endpoints/${d.id}`} className="card" style={{ background: "var(--bg-panel-2)", display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 10 }}>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: 14 }}>{d.hostname}</div>
                    <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{d.id}</div>
                  </div>
                  <div style={{ display: "flex", gap: 6, flexWrap: "wrap", justifyContent: "flex-end" }}>
                    <span className={`badge ${d.health === "healthy" ? "green" : d.health === "warning" ? "amber" : d.health === "critical" ? "red" : "gray"}`}>
                      {d.health === "unknown" ? "no data" : d.health === "stale" ? "not reporting" : d.health}
                    </span>
                    <span className={`badge ${d.offline ? "gray" : "green"}`}>{d.offline ? "offline" : "online"}</span>
                  </div>
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 8, marginBottom: 10 }}>
                  <div style={{ textAlign: "center" }}>
                    <Cpu size={13} color={d.offline ? TONE_COLOR.gray : TONE_COLOR[usageTone(d.liveStatus?.cpuPct, CPU_USAGE_THRESHOLDS)]} />
                    <div className="mono" style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{d.liveStatus?.cpuPct ?? "—"}%</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <MemoryStick size={13} color={d.offline ? TONE_COLOR.gray : TONE_COLOR[usageTone(d.liveStatus?.ramPct, RAM_USAGE_THRESHOLDS)]} />
                    <div className="mono" style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{d.liveStatus?.ramPct ?? "—"}%</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <HardDrive size={13} color={d.offline ? TONE_COLOR.gray : TONE_COLOR[usageTone(d.liveStatus?.diskPct, DISK_USAGE_THRESHOLDS)]} />
                    <div className="mono" style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{d.liveStatus?.diskPct ?? "—"}%</div>
                  </div>
                  <div style={{ textAlign: "center" }}>
                    <BatteryMedium size={13} color={d.offline ? TONE_COLOR.gray : TONE_COLOR[batteryTone(d.liveStatus?.batteryPct)]} />
                    <div className="mono" style={{ fontSize: 12, fontWeight: 600, marginTop: 2 }}>{d.liveStatus?.batteryPct ?? "—"}%</div>
                  </div>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>Last seen {timeAgo(d.lastSeenAt)}</div>
              </Link>
            ))}
          </div>
        ) : withHealth.length > 0 && (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Device</th><th>Hostname</th><th>Health</th><th>Connection</th><th>Last Seen</th></tr></thead>
              <tbody>
                {withHealth.map((d) => (
                  <tr key={d.id}>
                    <td className="mono" style={{ fontSize: 11.5 }}><Link to={`/endpoints/${d.id}`} style={{ color: "var(--accent)" }}>{d.id}</Link></td>
                    <td className="truncate" style={{ fontWeight: 600, maxWidth: 260 }} title={d.hostname}>{d.hostname}</td>
                    <td><span className={`badge ${d.health === "healthy" ? "green" : d.health === "warning" ? "amber" : d.health === "critical" ? "red" : "gray"}`}>{d.health === "unknown" ? "no data" : d.health === "stale" ? "not reporting" : d.health}</span></td>
                    <td><span className={`badge ${d.offline ? "gray" : "green"}`}>{d.offline ? "offline" : "online"}</span></td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(d.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <h3 className="section-title">Not yet monitored</h3>
        <p className="section-sub" style={{ marginTop: 6, lineHeight: 1.6 }}>
          Network equipment, storage arrays, and data-center facilities aren't tracked by this system —
          it monitors endpoint laptops only. No fabricated numbers are shown for infrastructure that isn't
          actually being monitored.
        </p>
      </div>
    </div>
  );
}
