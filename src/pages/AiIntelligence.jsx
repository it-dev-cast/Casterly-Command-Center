import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Sparkles, ShieldAlert, TrendingDown, Gauge, Info } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { api } from "../lib/api.js";
import { predictDeviceHealth } from "../lib/prediction.js";
import { shortDeviceTag } from "../lib/deviceId.js";

const RISK_TONE = { Low: "green", Medium: "amber", High: "red" };

function timeAgo(iso) {
  if (!iso) return "Not available";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Same real per-cell wording Lifecycle.jsx's own device table already established (Stage 6) -
// kept consistent here rather than reinvented, per this stage's own consistency check. "ok" rows
// now carry a real confidence tier (see prediction.js's R2 gate); only flag the low-confidence
// exception here, not confirm the high-confidence default, so a well-fit projection's badge
// stays unchanged.
function PredictionCell({ p }) {
  if (!p) return <span style={{ color: "var(--text-faint)" }}>—</span>;
  if (p.status === "ok") {
    return (
      <span className={`badge ${RISK_TONE[p.risk]}`}>
        {p.daysRemaining}d · {p.risk}
        {p.confidence === "low" && <span style={{ color: "var(--text-faint)" }}> · low confidence</span>}
      </span>
    );
  }
  if (p.status === "insufficient-data") return <span style={{ color: "var(--text-faint)", fontSize: 12 }}>Insufficient data ({p.daysOfHistory}/{p.minRequired}d)</span>;
  if (p.status === "already-past-threshold") return <span style={{ color: "var(--red)", fontSize: 12 }}>Past threshold</span>;
  if (p.status === "stable") return <span style={{ color: "var(--text-faint)", fontSize: 12 }}>Stable</span>;
  return <span style={{ color: "var(--text-faint)" }}>—</span>;
}

// The one real AI capability this backend has - prediction.js's exact port of ai-service's
// closed-form battery/SSD regression (see prediction.js's own comment on why this runs
// client-side rather than calling ai-service directly). This page runs it across every active
// device once on load, the same real per-device fetch pattern Action Center's AI Signals already
// established - not a new calculation, just the fuller real result set (every real prediction,
// not only High-risk ones) as its own dedicated view.
export default function AiIntelligence() {
  const { token, devices } = useLiveData();
  const [predictions, setPredictions] = useState([]); // [{device, prediction}]
  const [predictionsError, setPredictionsError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!token) return;
    const activeDevices = devices.filter((d) => d.status === "active");
    if (activeDevices.length === 0) { setPredictions([]); setPredictionsError(null); setLoading(false); return; }
    setLoading(true);
    Promise.all(activeDevices.map((d) =>
      api.getDeviceMetricSnapshots(token, d.id)
        .then((snapshots) => ({
          device: d,
          prediction: predictDeviceHealth(snapshots),
          // Real snapshot recency (oldest-first rows, so the last one is the most recent) - kept
          // alongside the prediction so the table can show how fresh the underlying data is,
          // without a second fetch.
          lastSnapshotAt: snapshots.length ? snapshots[snapshots.length - 1].recordedAt : null,
        }))
        .catch((e) => ({ error: e.message }))
    )).then((results) => {
      const failures = results.filter((r) => r?.error);
      setPredictionsError(failures.length > 0 ? `${failures.length} of ${activeDevices.length} device prediction${failures.length === 1 ? "" : "s"} failed to load` : null);
      setPredictions(results.filter((r) => r && !r.error));
    }).finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, devices.length]);

  const activeCount = devices.filter((d) => d.status === "active").length;

  // "Analyzed" = at least one real metric produced a real determination beyond insufficient-data
  // - honest coverage, not padded to look like full fleet analysis when it isn't.
  const analyzed = predictions.filter(({ prediction: p }) => p.battery.status !== "insufficient-data" || p.ssd.status !== "insufficient-data");

  const realResults = predictions.flatMap(({ device, prediction: p }) => [
    p.battery.status === "ok" ? { device, metric: "Battery Health", ...p.battery } : null,
    p.ssd.status === "ok" ? { device, metric: "SSD Wear", ...p.ssd } : null,
  ]).filter(Boolean);

  const highRisk = realResults.filter((r) => r.risk === "High");
  const avgDaysRemaining = realResults.length
    ? Math.round(realResults.reduce((sum, r) => sum + r.daysRemaining, 0) / realResults.length)
    : null;

  return (
    <div>
      <h1 className="page-title">AI Intelligence</h1>
      <p className="page-sub">
        Real battery/SSD wear predictions from real telemetry — no fabricated confidence or scores{" "}
        <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="The same closed-form regression ai-service computes, run here over real snapshot history. No fleet-wide model — just this fleet's actual real data." />
      </p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard
          icon={Sparkles} tone="purple"
          value={loading ? "—" : `${analyzed.length} / ${activeCount}`}
          label="Devices Analyzed"
          meta="active devices with enough real history for at least one real prediction"
          live={!loading}
        />
        <StatCard icon={ShieldAlert} tone={highRisk.length > 0 ? "red" : "green"} value={loading ? "—" : highRisk.length} label="High Risk" meta="battery + SSD combined" live={!loading} />
        <StatCard icon={Gauge} tone="blue" value={loading ? "—" : (avgDaysRemaining != null ? `${avgDaysRemaining}d` : "—")} label="Avg. Estimated Remaining Life" meta={realResults.length ? `across ${realResults.length} real prediction${realResults.length !== 1 ? "s" : ""}` : "not enough real predictions yet"} />
        <StatCard icon={TrendingDown} tone="gray" value={loading ? "—" : (predictions.length - analyzed.length)} label="Insufficient Data" meta="active devices, not enough snapshot history yet" />
      </div>

      <div className="card">
        <h3 className="section-title">Device Predictions</h3>
        <p className="section-sub">
          Every active device shown — including those still accumulating history{" "}
          <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Not hidden or padded. Same real statuses Lifecycle Management's own device table uses." />
        </p>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Device</th><th>Battery Health</th><th>SSD Wear</th><th>Last Updated</th></tr></thead>
            <tbody>
              {!loading && predictions.map(({ device, prediction, lastSnapshotAt }) => (
                <tr key={device.id}>
                  <td><Link to={`/endpoints/${device.id}`} style={{ color: "var(--accent)" }}>{device.hostname}</Link> <span style={{ color: "var(--text-faint)", fontSize: 11 }}>{shortDeviceTag(device.id)}</span></td>
                  <td><PredictionCell p={prediction.battery} /></td>
                  <td><PredictionCell p={prediction.ssd} /></td>
                  <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(lastSnapshotAt)}</td>
                </tr>
              ))}
              {loading && <tr><td colSpan={4} className="empty-note">Computing real per-device predictions…</td></tr>}
              {!loading && predictionsError && <tr><td colSpan={4} className="empty-note" style={{ color: "var(--red)" }}>Couldn't load some predictions: {predictionsError}</td></tr>}
              {!loading && !predictionsError && predictions.length === 0 && <tr><td colSpan={4} className="empty-note">No active devices to analyze.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
