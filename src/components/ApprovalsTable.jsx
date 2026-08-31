import { Link } from "react-router-dom";

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// The one real ADE approval-request table, shared by ApprovalsPage (full tenant-wide history),
// Lifecycle.jsx, and DeviceDetail.jsx's Approvals tab - previously three independently-maintained
// copies of the same real columns/logic. Action Center's own approvals widget stays separate on
// purpose: it only ever shows pending requests in a simpler, compact framing appropriate for a
// "what needs a decision" summary, not this page's fuller real history.
export default function ApprovalsTable({ approvals, loading, error, busyId, onApprove, onReject, showDevice = true, emptyMessage = "No approval requests." }) {
  const columnCount = showDevice ? 6 : 5;
  return (
    <div className="table-scroll">
      <table className="data-table">
        <thead>
          <tr>
            <th>Action</th>
            {showDevice && <th>Device</th>}
            <th>Status</th>
            <th>Requested</th>
            <th>Decided</th>
            <th>Token Validity</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {!loading && approvals.map((a) => (
            <tr key={a.id}>
              <td style={{ fontWeight: 600 }}>{a.action}</td>
              {showDevice && (
                <td className="mono" style={{ fontSize: 11.5 }}>
                  <Link to={`/endpoints/${a.deviceId}`} style={{ color: "var(--accent)" }}>{a.deviceId}</Link>
                </td>
              )}
              <td><span className={`badge ${a.status === "approved" ? "green" : a.status === "rejected" ? "red" : "amber"}`}>{a.status}</span></td>
              <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(a.createdAt)}</td>
              <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{a.decidedAt ? timeAgo(a.decidedAt) : "—"}</td>
              <td className="mono" style={{ fontSize: 11.5 }}>
                {a.status !== "approved" || !a.expiresAt ? (
                  <span style={{ color: "var(--text-faint)" }}>—</span>
                ) : new Date(a.expiresAt) > new Date() ? (
                  <span style={{ color: "var(--green)" }}>Valid until {new Date(a.expiresAt).toLocaleTimeString()}</span>
                ) : (
                  <span style={{ color: "var(--text-faint)" }}>Expired</span>
                )}
              </td>
              <td>
                {a.status === "pending" ? (
                  <div style={{ display: "flex", gap: 6 }}>
                    <button className="btn primary" disabled={busyId === a.id} onClick={() => onApprove(a.id)}>Approve</button>
                    <button className="btn" disabled={busyId === a.id} onClick={() => onReject(a.id)}>Reject</button>
                  </div>
                ) : <span style={{ color: "var(--text-faint)", fontSize: 12 }}>—</span>}
              </td>
            </tr>
          ))}
          {loading && <tr><td colSpan={columnCount} className="empty-note">Loading approval requests…</td></tr>}
          {!loading && error && <tr><td colSpan={columnCount} className="empty-note" style={{ color: "var(--red)" }}>Couldn't load approval requests: {error}</td></tr>}
          {!loading && !error && approvals.length === 0 && <tr><td colSpan={columnCount} className="empty-note">{emptyMessage}</td></tr>}
        </tbody>
      </table>
    </div>
  );
}
