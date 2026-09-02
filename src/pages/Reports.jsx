import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { FileText, Monitor, ClipboardList, ShieldAlert, AlertTriangle, CheckCircle2, Clock, WifiOff, Info } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { api } from "../lib/api.js";

export default function Reports() {
  const { token, devices, events, offlineDevices } = useLiveData();
  const [incidents, setIncidents] = useState([]);
  const [incidentsError, setIncidentsError] = useState(null);

  useEffect(() => {
    if (!token) return;
    setIncidentsError(null);
    api.listIncidents(token).then(setIncidents).catch((e) => setIncidentsError(e.message));
  }, [token]);

  const activeDevices = devices.filter((d) => d.status === "active").length;
  const resolvedIncidents = incidents.filter((i) => i.status === "resolved" || i.status === "closed").length;
  // "Open" mirrors Incidents.jsx's own OPEN_STATUSES semantics (everything short of
  // resolved/closed) without importing that page's local const, to keep this page's real derived
  // counts simple and self-contained rather than coupling two pages' internals together.
  const openIncidents = incidents.filter((i) => i.status !== "resolved" && i.status !== "closed").length;
  const criticalEvents = events.filter((e) => e.severity === "critical").length;
  const warningEvents = events.filter((e) => e.severity === "warning").length;

  return (
    <div>
      <h1 className="page-title">Reports</h1>
      <p className="page-sub">Real counts derived from your actual data — no fabricated report categories</p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard icon={Monitor} tone="blue" value={activeDevices} label="Active Devices" meta={`${devices.length} registered total`} live />
        <StatCard icon={ClipboardList} tone="teal" value={events.length} label="Total Events Logged" live />
        <StatCard icon={ShieldAlert} tone="red" value={criticalEvents} label="Critical Events" live />
        <StatCard icon={AlertTriangle} tone="amber" value={warningEvents} label="Warning Events" live />
        <StatCard icon={CheckCircle2} tone="green" value={`${incidents.length ? resolvedIncidents : 0}/${incidents.length}`} label="Incidents Resolved" />
        <StatCard icon={Clock} tone="purple" value={openIncidents} label="Open Incidents" />
        <StatCard icon={WifiOff} tone="gray" value={offlineDevices.length} label="Devices Currently Offline" meta="liveness, not health" live />
      </div>

      {incidentsError && (
        <div className="callout red" style={{ marginBottom: 16 }}>
          Couldn't load incident counts: {incidentsError} — the "Incidents Resolved" figure above may be incomplete.
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <h3 className="section-title">Devices Currently Offline</h3>
        <p className="section-sub">
          Liveness, not health{" "}
          <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Real-time: the later of lastSeenAt and live-status recency compared against the tenant's offline threshold, re-checked continuously - not dependent on the offline event still being in the recent event window. A stale device's health shows as 'stale,' not its last reading." />
        </p>
        {offlineDevices.length === 0 ? (
          <div className="empty-note">No active devices are currently offline.</div>
        ) : (
          <div className="table-scroll">
            <table className="data-table">
              <thead><tr><th>Device</th><th>Status</th></tr></thead>
              <tbody>
                {offlineDevices.map((d) => (
                  <tr key={d.id}>
                    <td><Link to={`/endpoints/${d.id}`} style={{ color: "var(--accent)" }}>{d.hostname}</Link></td>
                    <td><span className="badge gray">Offline</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 20px", textAlign: "center" }}>
          <FileText size={32} color="var(--text-faint)" style={{ marginBottom: 14 }} />
          <h3 className="section-title" style={{ marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
            No generated reports yet
            <Info size={13} color="var(--text-faint)" style={{ cursor: "help" }} title="A real report-generation engine (scheduled exports, historical trend analysis, downloadable PDF/CSV reports) isn't built yet — so nothing further is shown here rather than presenting non-functional placeholder links." />
          </h3>
          <p className="section-sub" style={{ maxWidth: 440 }}>
            Report generation isn't available yet. The counts above are real and live.
          </p>
        </div>
      </div>
    </div>
  );
}
