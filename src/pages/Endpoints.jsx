import { useEffect, useMemo, useState } from "react";
import { useSearchParams, Link, useNavigate } from "react-router-dom";
import { Monitor, CheckCircle2, AlertTriangle, ShieldX, WifiOff, Download, ArrowUp, ArrowDown } from "lucide-react";
import GlanceCell from "../components/GlanceCell.jsx";
import { useLiveData, healthFromLiveStatus, getUsageTextColor, CPU_USAGE_THRESHOLDS, RAM_USAGE_THRESHOLDS, DISK_USAGE_THRESHOLDS } from "../context/LiveDataContext.jsx";
import { useDialog } from "../context/DialogContext.jsx";
import { computeOfflineDeviceIds } from "../lib/deviceLiveness.js";
import { api } from "../lib/api.js";
import { latestBatteryHealthPct, batteryHealthColor } from "../lib/batteryHealth.js";
import { getLiveDetail, liveBatteryHealthPct } from "../lib/liveDetail.js";

function timeAgo(iso) {
  if (!iso) return "Not available";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// Real, derived "what's actually wrong right now" for a single device - reuses the exact same
// threshold constants every StatCard/column on this page already colors by (CPU/RAM/DISK
// thresholds from LiveDataContext, the same >50/20 battery bands used elsewhere), just applied
// per-row instead of per-tile. Returns null when there's no live reading yet (health "unknown"),
// distinct from returning "no issue" when there genuinely is live data and nothing is over
// threshold - never fabricates a signal that isn't backed by an actual crossed threshold.
function currentSignal(liveStatus) {
  if (!liveStatus) return null;
  const checks = [
    { label: "CPU", value: liveStatus.cpuPct, thresholds: CPU_USAGE_THRESHOLDS },
    { label: "RAM", value: liveStatus.ramPct, thresholds: RAM_USAGE_THRESHOLDS },
    { label: "Disk", value: liveStatus.diskPct, thresholds: DISK_USAGE_THRESHOLDS },
  ];
  for (const c of checks) {
    if (c.value != null && c.value > c.thresholds.critical) return { label: `${c.label} ${c.value}%`, tone: "red" };
  }
  for (const c of checks) {
    if (c.value != null && c.value > c.thresholds.warning) return { label: `${c.label} ${c.value}%`, tone: "amber" };
  }
  if (liveStatus.batteryPct != null && liveStatus.batteryPct < 20) return { label: `Battery ${liveStatus.batteryPct}%`, tone: "red" };
  if (liveStatus.batteryPct != null && liveStatus.batteryPct <= 50) return { label: `Battery ${liveStatus.batteryPct}%`, tone: "amber" };
  return { label: "No active issue", tone: "gray" };
}

const HEALTH_RANK = { critical: 0, warning: 1, unknown: 2, healthy: 3 };

// Small reusable sortable column header - client-side only, over fields already loaded for every
// row (health/hostname/lastSeenAt), never a field that isn't already in memory.
function SortHeader({ label, sortKey, sort, onSort, style }) {
  const active = sort.key === sortKey;
  return (
    <th style={{ ...style, cursor: "pointer", userSelect: "none" }} onClick={() => onSort(sortKey)}>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 3 }}>
        {label}
        {active && (sort.dir === 1 ? <ArrowUp size={11} /> : <ArrowDown size={11} />)}
      </span>
    </th>
  );
}

function exportToCsv(rows) {
  const headers = ["Device ID", "Hostname", "Tags", "CPU %", "RAM %", "Disk %", "Battery Health %", "Health", "Connection", "Status", "Enrolled", "Last Seen"];
  const lines = rows.map((d) => [
    d.id, d.hostname, (d.tags || []).join(";"),
    d.liveStatus?.cpuPct ?? "", d.liveStatus?.ramPct ?? "", d.liveStatus?.diskPct ?? "", d.batteryHealthPct ?? "",
    d.health, d.connection ?? "", d.status, d.enrolledAt || "", d.lastSeenAt || "",
  ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","));
  const csv = [headers.join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `endpoints-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function Endpoints() {
  const { devices, liveStatusByDevice, events, recentDeviceIds, revokeDevice, resetFingerprint, pushToast, token } = useLiveData();
  const { confirmAsync } = useDialog();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const [healthFilter, setHealthFilter] = useState(searchParams.get("health") || "all");
  const [connectionFilter, setConnectionFilter] = useState(searchParams.get("connection") || "all");
  const showArchive = searchParams.get("archive") === "1";

  useEffect(() => {
    setHealthFilter(searchParams.get("health") || "all");
    setConnectionFilter(searchParams.get("connection") || "all");
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);
  const [sort, setSort] = useState({ key: null, dir: 1 });
  const [busyId, setBusyId] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [batteryHealthById, setBatteryHealthById] = useState({});

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

  function updateHealthFilter(next) {
    setHealthFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("health"); else params.set("health", next);
    setSearchParams(params, { replace: true });
  }

  function updateConnectionFilter(next) {
    setConnectionFilter(next);
    const params = new URLSearchParams(searchParams);
    if (next === "all") params.delete("connection"); else params.set("connection", next);
    setSearchParams(params, { replace: true });
  }

  function updateArchive(next) {
    const params = new URLSearchParams(searchParams);
    if (next) params.set("archive", "1"); else params.delete("archive");
    setSearchParams(params, { replace: true });
  }

  // Real, URL-shareable search - was previously read-only from the URL (a /endpoints?q=... link
  // would seed the box but typing never updated the address bar back), same replace:true pattern
  // health/connection already use so it doesn't spam browser history per keystroke.
  function updateQuery(next) {
    setQuery(next);
    const params = new URLSearchParams(searchParams);
    if (!next) params.delete("q"); else params.set("q", next);
    setSearchParams(params, { replace: true });
  }

  function toggleSort(key) {
    setSort((prev) => (prev.key === key ? { key, dir: -prev.dir } : { key, dir: 1 }));
  }

  // Real, derived from the same tenant-wide event buffer every other page already reads (no new
  // fetch) - events arrives newest-first (see LiveDataContext's [event, ...prev] prepend), so the
  // first match per device is genuinely its most recent real event.
  const lastEventByDevice = {};
  for (const e of events) {
    if (!(e.deviceId in lastEventByDevice)) lastEventByDevice[e.deviceId] = e;
  }
  // Real per-device liveness, reused from the same utility Dashboard/Action Center/Device 360
  // already use - not re-derived. Only meaningful for active devices; a revoked device isn't
  // expected to report at all, so it isn't "offline," it's a different real lifecycle state.
  const offlineIds = computeOfflineDeviceIds(events, liveStatusByDevice);

  const withHealth = devices.map((d) => ({
    ...d,
    liveStatus: liveStatusByDevice[d.id],
    health: healthFromLiveStatus(liveStatusByDevice[d.id]),
    lastEvent: lastEventByDevice[d.id],
    connection: d.status !== "active" ? null : offlineIds.has(d.id) ? "offline" : "online",
    batteryHealthPct: liveBatteryHealthPct(liveStatusByDevice[d.id], batteryHealthById[d.id] ?? null),
  }));

  const roster = withHealth.filter((d) => (showArchive ? d.status === "revoked" : d.status === "active"));

  const filtered = useMemo(() => {
    const rows = roster.filter((d) => {
      const detail = getLiveDetail(d.liveStatus);
      const hay = `${d.id} ${d.hostname} ${detail.manufacturer || ""} ${detail.model || ""} ${detail.serial || ""} ${(d.tags || []).join(" ")}`.toLowerCase();
      const matchesQuery = !query || hay.includes(query.toLowerCase());
      const matchesHealth = healthFilter === "all" || d.health === healthFilter;
      const matchesConnection = connectionFilter === "all" || d.connection === connectionFilter;
      return matchesQuery && matchesHealth && matchesConnection;
    });
    if (!sort.key) return rows;
    const sorted = [...rows].sort((a, b) => {
      if (sort.key === "health") return (HEALTH_RANK[a.health] - HEALTH_RANK[b.health]) * sort.dir;
      if (sort.key === "lastSeen") return ((a.lastSeenAt ? new Date(a.lastSeenAt).getTime() : -Infinity) - (b.lastSeenAt ? new Date(b.lastSeenAt).getTime() : -Infinity)) * sort.dir;
      if (sort.key === "device") return a.hostname.localeCompare(b.hostname) * sort.dir;
      return 0;
    });
    return sorted;
  }, [roster, query, healthFilter, connectionFilter, sort]);

  const active = devices.filter((d) => d.status === "active").length;
  const revoked = devices.filter((d) => d.status === "revoked").length;
  // Scoped to active devices, matching Dashboard/Infrastructure's own convention - a revoked
  // device's stale/absent liveStatus would otherwise just noise up these counts as "unknown".
  const activeWithHealth = withHealth.filter((d) => d.status === "active");
  const healthy = activeWithHealth.filter((d) => d.health === "healthy").length;
  const warning = activeWithHealth.filter((d) => d.health === "warning").length;
  const critical = activeWithHealth.filter((d) => d.health === "critical").length;
  const offlineCount = activeWithHealth.filter((d) => d.connection === "offline").length;

  const selectableIds = filtered.filter((d) => d.status === "active").map((d) => d.id);
  const allSelected = selectableIds.length > 0 && selectableIds.every((id) => selected.has(id));

  function toggleOne(id) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectableIds));
  }

  async function handleRevoke(deviceId) {
    const ok = await confirmAsync(`Revoke ${deviceId}? Its API key will be rejected immediately.`, "Revoke");
    if (!ok) return;
    setBusyId(deviceId);
    try {
      await revokeDevice(deviceId);
      pushToast("success", "Device revoked", `${deviceId}'s API key is now rejected immediately.`);
    } catch (e) {
      pushToast("error", "Revoke failed", e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleResetFingerprint(deviceId) {
    const ok = await confirmAsync(`Reset hardware fingerprint baseline for ${deviceId}? Use this after a legitimate hardware upgrade.`, "Reset");
    if (!ok) return;
    setBusyId(deviceId);
    try {
      await resetFingerprint(deviceId);
      pushToast("success", "Fingerprint reset", "Baseline cleared — next hardware-check will capture a fresh one.");
    } catch (e) {
      pushToast("error", "Reset failed", e.message);
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulkRevoke() {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    const ok = await confirmAsync(`Revoke ${ids.length} selected device${ids.length > 1 ? "s" : ""}? Their API keys will be rejected immediately.`, "Revoke All");
    if (!ok) return;
    setBulkBusy(true);
    let succeeded = 0;
    let failed = 0;
    for (const id of ids) {
      try {
        await revokeDevice(id);
        succeeded++;
      } catch {
        failed++;
      }
    }
    setBulkBusy(false);
    setSelected(new Set());
    if (failed === 0) {
      pushToast("success", "Bulk revoke complete", `${succeeded} device${succeeded !== 1 ? "s" : ""} revoked.`);
    } else {
      pushToast("error", "Bulk revoke partially failed", `${succeeded} succeeded, ${failed} failed.`);
    }
  }

  return (
    <div>
      <div className="section-head">
        <div>
          <h1 className="page-title">{showArchive ? "Revoked enrollments" : "Endpoints"}</h1>
          <p className="page-sub">
            {showArchive
              ? "Archive — API keys already rejected. Not part of the live fleet."
              : `${active} live device${active === 1 ? "" : "s"}`}
          </p>
        </div>
        {revoked > 0 && (
          <button className="btn" onClick={() => updateArchive(!showArchive)}>
            {showArchive ? "Back to live fleet" : `${revoked} revoked in archive`}
          </button>
        )}
      </div>

      {!showArchive && (
        <div className="glance-strip" style={{ marginBottom: 20 }}>
          <GlanceCell to="/endpoints" tone="blue" icon={Monitor} value={active} label="Fleet" />
          <GlanceCell to="/endpoints?health=healthy" tone="green" icon={CheckCircle2} value={healthy} label="Healthy" />
          <GlanceCell to="/endpoints?health=warning" tone="amber" icon={AlertTriangle} value={warning} label="Warning" />
          <GlanceCell to="/endpoints?health=critical" tone="red" icon={ShieldX} value={critical} label="Critical" />
          <GlanceCell to="/endpoints?connection=offline" tone="slate" icon={WifiOff} value={offlineCount} label="Offline" meta="liveness, not health" />
        </div>
      )}

      <div className="card">
        <div className="section-head">
          <div>
            <h3 className="section-title">{showArchive ? "Archive" : "Live fleet"}</h3>
            <p className="section-sub">{filtered.length} device{filtered.length === 1 ? "" : "s"}</p>
          </div>
          <div style={{ display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" }}>
            {!showArchive && (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="section-sub" style={{ fontSize: 11 }}>Health</span>
                  {["all", "healthy", "warning", "critical", "unknown"].map((h) => (
                    <button
                      key={h}
                      className={`pill-select ${healthFilter === h ? "active" : ""}`}
                      onClick={() => updateHealthFilter(h)}
                    >
                      {h[0].toUpperCase() + h.slice(1)}
                    </button>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span className="section-sub" style={{ fontSize: 11 }}>Connection</span>
                  {["all", "online", "offline"].map((c) => (
                    <button
                      key={c}
                      className={`pill-select ${connectionFilter === c ? "active" : ""}`}
                      onClick={() => updateConnectionFilter(c)}
                    >
                      {c[0].toUpperCase() + c.slice(1)}
                    </button>
                  ))}
                </div>
              </>
            )}
            <button className="btn" onClick={() => exportToCsv(filtered)} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <Download size={14} /> Export CSV
            </button>
          </div>
        </div>

        <input
          className="search-box"
          style={{ width: "100%", marginBottom: 16, fontSize: 14, maxWidth: "none", borderRadius: "var(--radius)" }}
          placeholder="Search by device ID, hostname, or tag..."
          value={query}
          onChange={(e) => updateQuery(e.target.value)}
        />

        {selected.size > 0 && (
          <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "10px 14px", marginBottom: 12, borderRadius: "var(--radius)", background: "var(--bg-panel-2)", border: "1px solid var(--border-soft)" }}>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{selected.size} selected</span>
            <button className="btn danger" onClick={handleBulkRevoke} disabled={bulkBusy}>
              {bulkBusy ? "Revoking…" : "Revoke Selected"}
            </button>
            <button className="btn" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        )}

        <div className="table-scroll" style={{ maxHeight: 560, overflowY: "auto" }}>
          <table className="data-table">
            <thead>
              <tr>
                {!showArchive && (
                  <th style={{ width: 32 }}><input type="checkbox" checked={allSelected} onChange={toggleAll} disabled={selectableIds.length === 0} /></th>
                )}
                <SortHeader label="Device" sortKey="device" sort={sort} onSort={toggleSort} />
                {showArchive ? (
                  <>
                    <th>Enrolled</th>
                    <SortHeader label="Last Seen" sortKey="lastSeen" sort={sort} onSort={toggleSort} />
                    <th>Last Event</th>
                  </>
                ) : (
                  <>
                    <th style={{ textAlign: "right" }}>CPU</th>
                    <th style={{ textAlign: "right" }}>RAM</th>
                    <th style={{ textAlign: "right" }}>Disk</th>
                    <th style={{ textAlign: "right" }}>Battery health</th>
                    <SortHeader label="Health" sortKey="health" sort={sort} onSort={toggleSort} />
                    <th>Connection</th>
                    <th>Signal</th>
                    <SortHeader label="Last Seen" sortKey="lastSeen" sort={sort} onSort={toggleSort} />
                    <th>Actions</th>
                  </>
                )}
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr
                  key={d.id}
                  className={recentDeviceIds.has(d.id) ? "flash" : ""}
                  style={{ cursor: "pointer" }}
                  onClick={(e) => {
                    if (e.target.closest("input, button, a")) return;
                    navigate(`/endpoints/${d.id}`);
                  }}
                >
                  {!showArchive && (
                    <td>
                      <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggleOne(d.id)} />
                    </td>
                  )}
                  <td style={{ maxWidth: 260 }}>
                    <Link to={`/endpoints/${d.id}`} className="truncate" style={{ color: "var(--accent)", fontWeight: 600, display: "block" }} title={d.hostname}>{d.hostname}</Link>
                    <div className="truncate" style={{ fontSize: 11, color: "var(--text-dim)" }} title={getLiveDetail(d.liveStatus).model || d.id}>
                      {getLiveDetail(d.liveStatus).model || getLiveDetail(d.liveStatus).manufacturer || d.id}
                    </div>
                  </td>
                  {showArchive ? (
                    <>
                      <td style={{ color: "var(--text-faint)" }}>{timeAgo(d.enrolledAt)}</td>
                      <td style={{ color: "var(--text-faint)" }}>{timeAgo(d.lastSeenAt)}</td>
                      <td className="truncate" style={{ maxWidth: 280, fontSize: 12 }} title={d.lastEvent?.message}>
                        {d.lastEvent ? `${d.lastEvent.eventType} · ${timeAgo(d.lastEvent.createdAt)}` : "—"}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: getUsageTextColor(d.liveStatus?.cpuPct, CPU_USAGE_THRESHOLDS) }}>{d.liveStatus?.cpuPct != null ? `${d.liveStatus.cpuPct}%` : "—"}</td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: getUsageTextColor(d.liveStatus?.ramPct, RAM_USAGE_THRESHOLDS) }}>{d.liveStatus?.ramPct != null ? `${d.liveStatus.ramPct}%` : "—"}</td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: getUsageTextColor(d.liveStatus?.diskPct, DISK_USAGE_THRESHOLDS) }}>{d.liveStatus?.diskPct != null ? `${d.liveStatus.diskPct}%` : "—"}</td>
                      <td className="mono" style={{ textAlign: "right", fontWeight: 600, color: batteryHealthColor(d.batteryHealthPct) }}>{d.batteryHealthPct != null ? `${d.batteryHealthPct}%` : "—"}</td>
                      <td>
                        <span className={`badge ${d.health === "healthy" ? "green" : d.health === "warning" ? "amber" : d.health === "critical" ? "red" : "gray"}`}>
                          {d.health === "unknown" ? "no data" : d.health}
                        </span>
                      </td>
                      <td>
                        <span className={`badge ${d.connection === "online" ? "green" : "gray"}`}>{d.connection ?? "—"}</span>
                      </td>
                      <td>
                        {(() => {
                          const s = currentSignal(d.liveStatus);
                          if (!s) return <span style={{ color: "var(--text-faint)" }}>—</span>;
                          return <span className={`badge ${s.tone}`}>{s.label}</span>;
                        })()}
                      </td>
                      <td style={{ color: "var(--text-faint)" }}>{timeAgo(d.lastSeenAt)}</td>
                      <td>
                        <div style={{ display: "flex", gap: 6 }}>
                          <button className="btn" disabled={busyId === d.id} onClick={() => handleResetFingerprint(d.id)} title="Reset hardware fingerprint baseline">
                            Reset FP
                          </button>
                          <button className="btn danger" disabled={busyId === d.id} onClick={() => handleRevoke(d.id)} title="Revoke this device's API key">
                            Revoke
                          </button>
                        </div>
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr>
                  <td colSpan={showArchive ? 4 : 11} className="empty-note">
                    {showArchive
                      ? (query ? `No revoked enrollments match "${query}".` : "No revoked enrollments.")
                      : devices.filter((d) => d.status === "active").length === 0
                        ? "No live devices. Run local-agent to enroll one."
                        : query
                          ? `No devices match "${query}".`
                          : "No devices match the current filters."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
