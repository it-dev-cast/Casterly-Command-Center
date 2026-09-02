import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { ShieldCheck, ShieldQuestion, Award, Clock, Check, X, CheckCircle2, XCircle, ListChecks, Lock } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import ApprovalsTable from "../components/ApprovalsTable.jsx";
import { api } from "../lib/api.js";
import { predictDeviceHealth } from "../lib/prediction.js";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { useRefetchOnEvent, isApprovalEvent } from "../hooks/useRefetchOnEvent.js";

const STATUS_TONE = { Active: "green", Expiring: "amber", Grace: "amber", Expired: "red", Suspended: "red" };
const RISK_TONE = { Low: "green", Medium: "amber", High: "red" };

// Compact real prediction cell - same four real statuses prediction.js ever returns
// (ok/insufficient-data/already-past-threshold/stable). "ok" rows now carry a real confidence
// tier (see prediction.js's R2 gate); only flag the low-confidence exception here, not confirm
// the high-confidence default, so a well-fit projection's badge stays unchanged.
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
  if (p.status === "insufficient-data") return <span style={{ color: "var(--text-faint)", fontSize: 12 }}>Insufficient data</span>;
  if (p.status === "already-past-threshold") return <span style={{ color: "var(--red)", fontSize: 12 }}>Past threshold</span>;
  if (p.status === "stable") return <span style={{ color: "var(--text-faint)", fontSize: 12 }}>Stable</span>;
  return <span style={{ color: "var(--text-faint)" }}>—</span>;
}

export default function Lifecycle() {
  const { token, devices, events, pushToast, entitlement } = useLiveData();
  const [approvals, setApprovals] = useState([]);
  const [approvalsError, setApprovalsError] = useState(null);
  const [selectedDeviceId, setSelectedDeviceId] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(true);
  const [busyRequestId, setBusyRequestId] = useState(null);
  const [fleetPredictions, setFleetPredictions] = useState([]);
  const [fleetLoading, setFleetLoading] = useState(true);

  useEffect(() => {
    if (!devices.length) return;
    if (!selectedDeviceId || !devices.some((d) => d.id === selectedDeviceId)) {
      setSelectedDeviceId(devices.find((d) => d.status === "active")?.id || devices[0].id);
    }
  }, [devices, selectedDeviceId]);

  useEffect(() => {
    if (!token) return;
    refreshApprovals();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);
  // Approval requests have no dedicated SSE push (see useRefetchOnEvent's own comment) - this is
  // the real bridge that keeps the ADE queue from going stale for an entire session just because
  // it was only ever fetched once on mount.
  useRefetchOnEvent(events, isApprovalEvent, refreshApprovals);

  useEffect(() => {
    if (!token || !selectedDeviceId) return;
    setSnapshotsLoading(true);
    api.getDeviceMetricSnapshots(token, selectedDeviceId).then(setSnapshots).catch(() => setSnapshots([])).finally(() => setSnapshotsLoading(false));
  }, [token, selectedDeviceId]);

  // Real per-device battery/SSD prediction, fleet-wide - same predictDeviceHealth function and
  // same one-batch-fetch-per-active-device pattern ActionCenter.jsx/AiIntelligence.jsx already
  // use, reused here rather than reimplemented so this page's own "AI-prediction data" subtitle
  // is actually backed by a real calculation, not just a raw snapshot chart. Scales linearly with
  // active device count - fine at this fleet's real size, same caveat already noted where this
  // pattern was first introduced.
  useEffect(() => {
    if (!token) return;
    const activeDevices = devices.filter((d) => d.status === "active");
    if (activeDevices.length === 0) { setFleetLoading(false); return; }
    setFleetLoading(true);
    Promise.all(activeDevices.map((d) =>
      api.getDeviceMetricSnapshots(token, d.id)
        .then((snaps) => ({ device: d, prediction: predictDeviceHealth(snaps) }))
        .catch(() => ({ device: d, prediction: null }))
    )).then(setFleetPredictions).finally(() => setFleetLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, devices.length]);

  async function refreshApprovals() {
    setApprovalsError(null);
    const list = await api.listApprovalRequests(token).catch((e) => { setApprovalsError(e.message); return []; });
    setApprovals(list);
  }

  async function handleApprove(id) {
    setBusyRequestId(id);
    try {
      await api.approveRequest(token, id);
      await refreshApprovals();
      pushToast("success", "Request approved", "The approval queue has been updated.");
    } catch (e) {
      pushToast("error", "Approval failed", e.message);
    } finally {
      setBusyRequestId(null);
    }
  }

  async function handleReject(id) {
    setBusyRequestId(id);
    try {
      await api.rejectRequest(token, id);
      await refreshApprovals();
      pushToast("success", "Request rejected", "The approval queue has been updated.");
    } catch (e) {
      pushToast("error", "Rejection failed", e.message);
    } finally {
      setBusyRequestId(null);
    }
  }

  const selectedDevice = devices.find((d) => d.id === selectedDeviceId);
  const pendingApprovals = approvals.filter((a) => a.status === "pending");
  const approvedCount = approvals.filter((a) => a.status === "approved").length;
  const rejectedCount = approvals.filter((a) => a.status === "rejected").length;
  const featuresIncluded = entitlement?.features?.filter((f) => f.included).length ?? 0;
  const chartData = snapshots.map((s) => ({
    date: new Date(s.recordedAt).toLocaleDateString(),
    "Battery Health %": s.batteryHealthPct,
    "SSD Wear %": s.ssdWearPct,
  }));

  return (
    <div>
      <h1 className="page-title">Lifecycle Management</h1>
      <p className="page-sub">Real subscription, hardware integrity, and AI-prediction data from your backend — not mock</p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard
          icon={Award} tone={STATUS_TONE[entitlement?.status] || "blue"}
          value={entitlement?.status || "—"}
          label={`Plan: ${entitlement?.plan || "—"}`}
          meta={entitlement?.expiresAt
            ? `${entitlement.renewedAt ? `Renewed ${new Date(entitlement.renewedAt).toLocaleDateString()} · ` : ""}Expires ${new Date(entitlement.expiresAt).toLocaleDateString()}`
            : undefined}
        />
        <StatCard
          icon={ShieldCheck} tone="blue"
          value={entitlement?.deviceCount ? `${entitlement.deviceCount.used}/${entitlement.deviceCount.licensed}` : "—"}
          label="Licensed Devices"
        />
        <StatCard icon={Clock} tone="amber" value={pendingApprovals.length} label="Pending Approvals" live />
        <StatCard icon={CheckCircle2} tone="green" value={approvedCount} label="Approved" meta="ADE requests" />
        <StatCard icon={XCircle} tone="red" value={rejectedCount} label="Rejected" meta="ADE requests" />
        <StatCard icon={ListChecks} tone="teal" value={featuresIncluded} label="Features Included" meta={entitlement ? `of ${entitlement.features.length} on this plan` : undefined} />
        <StatCard icon={ShieldQuestion} tone={selectedDevice?.fingerprintLockedAt ? "green" : "amber"} value={selectedDevice?.fingerprintLockedAt ? "Locked" : "Pending"} label="Hardware Baseline" meta={selectedDevice?.hostname} />
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-head">
          <div>
            <h3 className="section-title">Plan Features</h3>
            <p className="section-sub">Real feature entitlement for plan: {entitlement?.plan || "—"}</p>
          </div>
        </div>
        {!entitlement && <div className="empty-note">Entitlement not yet synced.</div>}
        {entitlement && (
          <div className="grid grid-4">
            {entitlement.features.map((f) => (
              <div key={f.feature} style={{ display: "flex", alignItems: "center", gap: 8, padding: "8px 0" }}>
                {f.included ? <Check size={15} color="var(--green)" /> : <X size={15} color="var(--text-faint)" />}
                <span style={{ color: f.included ? "var(--text)" : "var(--text-faint)" }}>{f.feature}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Real per-device lifecycle table - the one gap the previous version of this page had:
          its own subtitle claimed "AI-prediction data" but never actually called
          predictDeviceHealth anywhere. Entitlement is intentionally NOT a column here - it's a
          tenant-wide fact (same value for every device), already shown once above in the summary
          tiles; repeating it per row would just be the same value N times, not real per-device
          information. Clicking a row (not the device link) selects it for the trend chart below. */}
      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-head">
          <div>
            <h3 className="section-title">Device Lifecycle</h3>
            <p className="section-sub">Real hardware baseline and AI battery/SSD prediction, per active device — click a row to view its trend below</p>
          </div>
        </div>
        <div className="table-scroll">
          <table className="data-table">
            <thead><tr><th>Device</th><th>Hardware Baseline</th><th>Battery Health</th><th>SSD Wear</th></tr></thead>
            <tbody>
              {!fleetLoading && fleetPredictions.map(({ device, prediction }) => (
                <tr key={device.id} onClick={() => setSelectedDeviceId(device.id)} style={{ cursor: "pointer", background: device.id === selectedDeviceId ? "var(--bg-panel-2)" : undefined }}>
                  <td>
                    <Link to={`/endpoints/${device.id}`} onClick={(e) => e.stopPropagation()} style={{ color: "var(--accent)", fontWeight: 600 }}>{device.hostname}</Link>
                  </td>
                  <td>
                    <span className={`badge ${device.fingerprintLockedAt ? "green" : "amber"}`}>
                      {device.fingerprintLockedAt ? <><Lock size={10} style={{ marginRight: 3, verticalAlign: -1 }} />Locked</> : "Pending"}
                    </span>
                  </td>
                  <td><PredictionCell p={prediction?.battery} /></td>
                  <td><PredictionCell p={prediction?.ssd} /></td>
                </tr>
              ))}
              {fleetLoading && <tr><td colSpan={4} className="empty-note">Computing real per-device predictions…</td></tr>}
              {!fleetLoading && fleetPredictions.length === 0 && <tr><td colSpan={4} className="empty-note">No active devices to show lifecycle data for.</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 20 }}>
        <div className="section-head">
          <div>
            <h3 className="section-title">Battery / SSD Health Trend</h3>
            <p className="section-sub">Real daily snapshots — accumulates over time, not backfilled</p>
          </div>
          <select className="pill-select" value={selectedDeviceId || ""} onChange={(e) => setSelectedDeviceId(e.target.value)}>
            {devices.map((d) => <option key={d.id} value={d.id}>{d.hostname} ({d.id})</option>)}
          </select>
        </div>
        {snapshotsLoading ? (
          <div className="empty-note">Loading snapshot history…</div>
        ) : chartData.length === 0 ? (
          <div className="empty-note">No daily snapshots yet — these accumulate once a day.</div>
        ) : (
          <div style={{ height: 260 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
                <XAxis dataKey="date" stroke="var(--text-faint)" fontSize={11.5} />
                <YAxis stroke="var(--text-faint)" fontSize={11.5} domain={[0, 100]} />
                <Tooltip contentStyle={{ background: "var(--bg-panel-2)", border: "1px solid var(--border)", borderRadius: "var(--radius)" }} />
                <Legend />
                <Line type="monotone" dataKey="Battery Health %" stroke="var(--green)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                <Line type="monotone" dataKey="SSD Wear %" stroke="var(--amber)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">ADE Approval Requests</h3>
            <p className="section-sub">Real high-impact action requests from your device — approve/reject issues a real signed token</p>
          </div>
          <Link to="/approvals" className="btn" style={{ fontSize: 12 }}>Full History →</Link>
        </div>
        <ApprovalsTable
          approvals={approvals}
          loading={false}
          error={approvalsError}
          busyId={busyRequestId}
          onApprove={handleApprove}
          onReject={handleReject}
          emptyMessage="No approval requests yet."
        />
      </div>
    </div>
  );
}
