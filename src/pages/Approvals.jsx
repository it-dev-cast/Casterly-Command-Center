import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { ClipboardCheck, Clock, CheckCircle2, XCircle } from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import ApprovalsTable from "../components/ApprovalsTable.jsx";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { api } from "../lib/api.js";

// The full real ADE approval-request history, tenant-wide - api.listApprovalRequests already
// returns every request regardless of status or device (confirmed against
// GET /v1/tenants/{id}/approval-requests), just previously only ever shown embedded inside
// Lifecycle.jsx alongside unrelated entitlement content. This is that same real data as its own
// dedicated page, with real filters.
export default function Approvals() {
  const { token, devices, pushToast } = useLiveData();
  const [approvals, setApprovals] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [busyId, setBusyId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [statusFilter, setStatusFilter] = useState(searchParams.get("status") || "all");
  const [deviceFilter, setDeviceFilter] = useState(searchParams.get("device") || "all");

  function refresh() {
    setLoading(true);
    setError(null);
    return api.listApprovalRequests(token)
      .then(setApprovals)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (!token) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  function updateStatusFilter(next) {
    setStatusFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("status"); else params.set("status", next);
    setSearchParams(params, { replace: true });
  }
  function updateDeviceFilter(next) {
    setDeviceFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("device"); else params.set("device", next);
    setSearchParams(params, { replace: true });
  }

  async function handleApprove(id) {
    setBusyId(id);
    try {
      await api.approveRequest(token, id);
      await refresh();
      pushToast("success", "Request approved", "A real signed token has been issued.");
    } catch (e) {
      pushToast("error", "Approval failed", e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleReject(id) {
    setBusyId(id);
    try {
      await api.rejectRequest(token, id);
      await refresh();
      pushToast("success", "Request rejected", "The approval queue has been updated.");
    } catch (e) {
      pushToast("error", "Rejection failed", e.message);
    } finally {
      setBusyId(null);
    }
  }

  const filtered = approvals
    .filter((a) => statusFilter === "all" || a.status === statusFilter)
    .filter((a) => deviceFilter === "all" || a.deviceId === deviceFilter);

  const pendingCount = approvals.filter((a) => a.status === "pending").length;
  const approvedCount = approvals.filter((a) => a.status === "approved").length;
  const rejectedCount = approvals.filter((a) => a.status === "rejected").length;
  const devicesWithApprovals = devices.filter((d) => approvals.some((a) => a.deviceId === d.id));

  return (
    <div>
      <h1 className="page-title">Approvals</h1>
      <p className="page-sub">Real ADE high-impact action requests, tenant-wide — approve/reject issues a real signed token</p>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        <StatCard icon={ClipboardCheck} tone="blue" value={approvals.length} label="Total Requests" live />
        <StatCard icon={Clock} tone="amber" value={pendingCount} label="Pending" live />
        <StatCard icon={CheckCircle2} tone="green" value={approvedCount} label="Approved" />
        <StatCard icon={XCircle} tone="red" value={rejectedCount} label="Rejected" />
      </div>

      <div className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">Approval History</h3>
            <p className="section-sub">{filtered.length} of {approvals.length} requests</p>
          </div>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <select className="pill-select" value={statusFilter} onChange={(e) => updateStatusFilter(e.target.value)}>
              <option value="all">All Statuses</option>
              <option value="pending">Pending</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </select>
            <select className="pill-select" value={deviceFilter} onChange={(e) => updateDeviceFilter(e.target.value)}>
              <option value="all">All Devices</option>
              {devicesWithApprovals.map((d) => <option key={d.id} value={d.id}>{d.hostname}</option>)}
            </select>
          </div>
        </div>

        <ApprovalsTable
          approvals={filtered}
          loading={loading}
          error={error}
          busyId={busyId}
          onApprove={handleApprove}
          onReject={handleReject}
          emptyMessage="No approval requests match these filters."
        />
      </div>
    </div>
  );
}
