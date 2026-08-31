import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  SlidersHorizontal, WifiOff, BellRing, Trash2, Plug, ShieldCheck, Copy, Check, Server, Radio,
  Waves, RefreshCw, ArrowRight, SunMoon, Sun, Moon, Monitor, Globe, History, Info,
} from "lucide-react";
import { BACKEND_URL, TENANT_ID, api } from "../lib/api.js";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { useApiHealth } from "../hooks/useApiHealth.js";
import { useTheme, THEME_REGISTRY } from "../hooks/useTheme.js";
import { preferencesStore, DATE_FORMATS, TIME_FORMATS, LANDING_PAGES, formatWithPrefs } from "../lib/dashboardPrefs.js";
import { notificationPrefsStore, NOTIFICATION_CATEGORIES } from "../lib/notificationPrefs.js";
import ChainIntegrityCard from "../components/ChainIntegrityCard.jsx";

// Real routes this dashboard/local-agent actually call - kept as accurate technical reference,
// just presented as a labeled list instead of a raw monospace block.
const ENDPOINT_REFERENCE = [
  { method: "POST", path: "/v1/devices/register", label: "Device Auth", description: "Local-agent registers this device and receives its real API key" },
  { method: "POST", path: "/v1/auth/login", label: "Admin Auth", description: "This dashboard signs in with the tenant admin password" },
  { method: "POST", path: "/v1/devices/{id}/live-status", label: "Live Telemetry", description: "Local-agent pushes real CPU/RAM/Disk/Battery readings, ~every 5s" },
  { method: "GET", path: `/v1/tenants/${TENANT_ID}/stream`, label: "Live Push", description: "Server-Sent Events — every real-time update on this dashboard arrives here" },
];

function CopyButton({ value, label }) {
  const { pushToast } = useLiveData();
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      pushToast("success", "Copied", `${label} copied to clipboard.`);
      setTimeout(() => setCopied(false), 1500);
    } catch (e) {
      pushToast("error", "Copy failed", e.message);
    }
  }

  return (
    <button className="icon-btn" onClick={handleCopy} title={`Copy ${label}`} aria-label={`Copy ${label}`}>
      {copied ? <Check size={14} color="var(--green)" /> : <Copy size={14} />}
    </button>
  );
}

// Real metrics only - the exact fields device_live_status actually has (backend/live.go's
// LiveStatus struct: cpuPct/ramPct/diskPct/batteryPct). The default operator per metric is a UX
// suggestion, not a hard rule - the backend itself allows either operator for any metric (e.g.
// "cpu < 5" is a real, legitimate way to flag an idle/asleep machine).
const METRIC_OPTIONS = [
  { value: "cpu", label: "CPU Usage", defaultOperator: ">" },
  { value: "ram", label: "RAM Usage", defaultOperator: ">" },
  { value: "disk", label: "Disk Usage", defaultOperator: ">" },
  { value: "battery", label: "Battery Charge", defaultOperator: "<" },
];
const METRIC_LABELS = Object.fromEntries(METRIC_OPTIONS.map((m) => [m.value, m.label]));

function timeAgo(iso) {
  if (!iso) return "—";
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Real categories only, grouped by what this content actually is - no placeholder categories for
// features (Users & Roles, Integrations, SLA & Policies, Customers, session timeout/2FA/SSO,
// editable retention policy, lifecycle policy engine) that don't exist in this backend. "General"
// is real client-only preferences (theme, date/time format, landing page - all localStorage,
// genuinely applied, not store-and-ignore); "Connection" stays scoped purely to real backend/API
// connectivity info - it didn't need renaming just because General absorbed the app-preference
// content, since its own scope never changed; "Notifications" is real per-category filtering of
// NotificationBell's real data; "Monitoring & Alerts" is the two real detection systems (liveness
// threshold, alert-rule engine); "Security & Integrity" is the one real tamper-evidence check;
// "Activity & Audit" is the real recent-event feed plus the real, previously-nowhere-shown 90-day/
// 200-per-device retention policy (backend/models.go's own constants). The honest "nothing else is
// built yet" disclosure isn't given its own nav entry - it isn't a settings category, just a
// footer note about the page as a whole.
const CATEGORIES = [
  { key: "general", label: "General", icon: SunMoon },
  { key: "connection", label: "Connection", icon: Plug },
  { key: "notifications", label: "Notifications", icon: BellRing },
  { key: "monitoring", label: "Monitoring & Alerts", icon: WifiOff },
  { key: "security", label: "Security & Integrity", icon: ShieldCheck },
  { key: "activity", label: "Activity & Audit", icon: History },
];

export default function Settings() {
  const { token, pushToast, connected, events, devices } = useLiveData();
  const { apiHealth, checking: checkingHealth, checkHealth } = useApiHealth();
  const [activeCategory, setActiveCategory] = useState("general");
  const lastEventAt = events[0]?.createdAt;

  const { theme, setTheme } = useTheme();
  const [prefs, setPrefs] = preferencesStore.useStore();
  const [notificationPrefs, setNotificationPrefs] = notificationPrefsStore.useStore();
  // Real, auto-detected fact - not editable, since it isn't actually a preference (the browser's
  // real timezone, computed once).
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;

  function toggleNotificationCategory(key) {
    setNotificationPrefs({ ...notificationPrefs, [key]: notificationPrefs[key] === false ? true : false });
  }

  const [threshold, setThreshold] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saving, setSaving] = useState(false);

  const [rules, setRules] = useState([]);
  const [rulesLoading, setRulesLoading] = useState(true);
  const [rulesError, setRulesError] = useState(null);
  const [busyRuleId, setBusyRuleId] = useState(null);
  const [newMetric, setNewMetric] = useState("cpu");
  const [newOperator, setNewOperator] = useState(">");
  const [newThreshold, setNewThreshold] = useState("90");
  const [newSeverity, setNewSeverity] = useState("warning");
  const [creating, setCreating] = useState(false);

  function refreshRules() {
    setRulesLoading(true);
    setRulesError(null);
    return api.listAlertRules(token)
      .then(setRules)
      .catch((e) => setRulesError(e.message))
      .finally(() => setRulesLoading(false));
  }

  useEffect(() => {
    if (!token) return;
    refreshRules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  async function handleCreateRule(e) {
    e.preventDefault();
    const thresholdNum = Number(newThreshold);
    if (!Number.isFinite(thresholdNum) || thresholdNum < 0 || thresholdNum > 100) {
      pushToast("error", "Invalid threshold", "Threshold must be a number between 0 and 100.");
      return;
    }
    setCreating(true);
    try {
      await api.createAlertRule(token, { metric: newMetric, operator: newOperator, threshold: thresholdNum, severity: newSeverity });
      await refreshRules();
      pushToast("success", "Alert rule created", `${METRIC_LABELS[newMetric]} ${newOperator} ${thresholdNum}% will now be evaluated every sweep.`);
    } catch (err) {
      pushToast("error", "Couldn't create rule", err.message);
    } finally {
      setCreating(false);
    }
  }

  async function handleToggleRule(rule) {
    setBusyRuleId(rule.id);
    try {
      await api.updateAlertRule(token, rule.id, { enabled: !rule.enabled });
      await refreshRules();
    } catch (err) {
      pushToast("error", "Couldn't update rule", err.message);
    } finally {
      setBusyRuleId(null);
    }
  }

  async function handleDeleteRule(rule) {
    setBusyRuleId(rule.id);
    try {
      await api.deleteAlertRule(token, rule.id);
      await refreshRules();
      pushToast("success", "Alert rule deleted", `${METRIC_LABELS[rule.metric]} ${rule.operator} ${rule.threshold}% is no longer evaluated.`);
    } catch (err) {
      pushToast("error", "Couldn't delete rule", err.message);
    } finally {
      setBusyRuleId(null);
    }
  }

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    setLoadError(null);
    api.getOfflineThreshold(token)
      .then((res) => { setThreshold(res.minutes); setInputValue(String(res.minutes)); })
      .catch((e) => setLoadError(e.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSave() {
    const minutes = Number(inputValue);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 60) {
      pushToast("error", "Invalid value", "Offline threshold must be a whole number between 1 and 60 minutes.");
      return;
    }
    setSaving(true);
    try {
      const res = await api.updateOfflineThreshold(token, minutes);
      setThreshold(res.minutes);
      setInputValue(String(res.minutes));
      pushToast("success", "Offline threshold updated", `Devices are now flagged offline after ${res.minutes} minute${res.minutes !== 1 ? "s" : ""} of silence.`);
    } catch (e) {
      pushToast("error", "Save failed", e.message);
    } finally {
      setSaving(false);
    }
  }

  const dirty = threshold != null && inputValue !== String(threshold);

  return (
    <div>
      <h1 className="page-title">Settings</h1>
      <p className="page-sub">Your dashboard's real, currently-live configuration</p>

      <div style={{ display: "flex", gap: 24, alignItems: "flex-start" }}>
        <div className="card" style={{ width: 220, flexShrink: 0, padding: 10 }}>
          {CATEGORIES.map((c) => {
            const Icon = c.icon;
            return (
              <div
                key={c.key}
                className={`nav-item ${activeCategory === c.key ? "active" : ""}`}
                onClick={() => setActiveCategory(c.key)}
                style={{ cursor: "pointer" }}
              >
                <Icon size={16} />
                <span>{c.label}</span>
              </div>
            );
          })}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {activeCategory === "general" && (
            <>
              <div className="card" style={{ marginBottom: 20 }}>
                <h3 className="section-title">Appearance</h3>
                <p className="section-sub">Real, applied immediately — no save button needed</p>
                <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                  {[
                    { value: "light", label: "Light", icon: Sun },
                    { value: "dark", label: "Dark", icon: Moon },
                    { value: "system", label: "System", icon: Monitor },
                  ].map((opt) => (
                    <button
                      key={opt.value}
                      className={`pill-select ${theme === opt.value ? "active" : ""}`}
                      onClick={() => setTheme(opt.value)}
                    >
                      <opt.icon size={13} style={{ marginRight: 5, verticalAlign: -2 }} />
                      {opt.label}
                    </button>
                  ))}
                </div>
                {theme === "system" && (
                  <p className="section-sub" style={{ marginTop: 8 }}>Following your OS's real light/dark setting — changes automatically if it changes.</p>
                )}
              </div>

              <div className="card" style={{ marginBottom: 20 }}>
                <h3 className="section-title">Theme</h3>
                <p className="section-sub">
                  9 palettes — each one restyles the whole console (canvas, chrome, accent). Severity colors stay the same.{" "}
                  <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Healthy / Warning / Critical / Info keep the same meaning in every theme." />
                </p>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))", gap: 8, marginTop: 10 }}>
                  {THEME_REGISTRY.map((t) => (
                    <button
                      key={t.id}
                      className={`pill-select ${theme === t.id ? "active" : ""}`}
                      onClick={() => setTheme(t.id)}
                      style={{ display: "flex", alignItems: "center", gap: 9, justifyContent: "flex-start", padding: "8px 10px" }}
                    >
                      <span
                        className="theme-swatch"
                        aria-hidden="true"
                        style={{ "--swatch-canvas": t.canvas, "--swatch-accent": t.accent }}
                      />
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="card" style={{ marginBottom: 20 }}>
                <h3 className="section-title">Regional</h3>
                <p className="section-sub">Real client-side preferences — persisted in this browser, applied wherever this dashboard renders a date/time</p>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Globe size={14} color="var(--text-faint)" />
                    <span style={{ fontSize: 13 }}>Timezone</span>
                  </div>
                  <span className="mono" style={{ fontSize: 12.5, color: "var(--text-dim)" }}>{timezone}</span>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <span style={{ fontSize: 13 }}>Date Format</span>
                  <select className="pill-select" value={prefs.dateFormat} onChange={(e) => setPrefs({ ...prefs, dateFormat: e.target.value })}>
                    {DATE_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                  <span style={{ fontSize: 13 }}>Time Format</span>
                  <select className="pill-select" value={prefs.timeFormat} onChange={(e) => setPrefs({ ...prefs, timeFormat: e.target.value })}>
                    {TIME_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                  </select>
                </div>

                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                  <span style={{ fontSize: 13, color: "var(--text-faint)" }}>Example (real, current time)</span>
                  <span className="mono" style={{ fontSize: 12.5 }}>{formatWithPrefs(new Date().toISOString(), prefs)}</span>
                </div>
              </div>

              <div className="card">
                <h3 className="section-title">Default Landing Page</h3>
                <p className="section-sub">Real preference — genuinely changes where the sidebar's Dashboard/root link takes you</p>
                <select className="pill-select" value={prefs.landingPage} onChange={(e) => setPrefs({ ...prefs, landingPage: e.target.value })} style={{ marginTop: 8 }}>
                  {LANDING_PAGES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
              </div>
            </>
          )}

          {activeCategory === "connection" && (
            <>
              <div className="card" style={{ marginBottom: 20 }}>
                <h3 className="section-title">Agent Connection</h3>
                <p className="section-sub">Your real local-agent and Go backend — this dashboard's actual configured connection</p>

                <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Backend URL</div>
                      <div className="mono" style={{ fontSize: 13.5, marginTop: 2 }}>{BACKEND_URL}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                      {checkingHealth ? (
                        <span className="badge gray">Checking…</span>
                      ) : (
                        <span className={`badge ${apiHealth?.ok ? "green" : "red"}`}>
                          {apiHealth?.ok ? "Connected" : "Unreachable"}{apiHealth?.ok && apiHealth?.latencyMs != null ? ` · ${apiHealth.latencyMs}ms` : ""}
                        </span>
                      )}
                      <CopyButton value={BACKEND_URL} label="Backend URL" />
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                    <div>
                      <div style={{ fontSize: 11, color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.04em" }}>Tenant ID</div>
                      <div className="mono" style={{ fontSize: 13.5, marginTop: 2 }}>{TENANT_ID}</div>
                    </div>
                    <CopyButton value={TENANT_ID} label="Tenant ID" />
                  </div>
                </div>
              </div>

              <div className="card" style={{ marginBottom: 20 }}>
                <h3 className="section-title">Endpoint Reference</h3>
                <p className="section-sub">Real routes this dashboard and your local-agent actually use</p>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 4 }}>
                  {ENDPOINT_REFERENCE.map((e) => (
                    <div key={e.path + e.method} style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <span className={`badge ${e.method === "GET" ? "blue" : "amber"}`} style={{ flexShrink: 0, marginTop: 1 }}>{e.method}</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                          <span style={{ fontWeight: 700, fontSize: 13 }}>{e.label}</span>
                          <span className="mono" style={{ fontSize: 12, color: "var(--text-faint)" }}>{e.path}</span>
                        </div>
                        <div style={{ fontSize: 12, color: "var(--text-dim)", marginTop: 2 }}>{e.description}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="card">
                <div className="section-head">
                  <div>
                    <h3 className="section-title">Platform Status</h3>
                    <p className="section-sub">Real signals — full detail and history on the Infrastructure page</p>
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <button className="btn" onClick={checkHealth} disabled={checkingHealth}>
                      <RefreshCw size={13} style={{ animation: checkingHealth ? "spin 0.8s linear infinite" : "none" }} /> Recheck
                    </button>
                    <Link to="/infrastructure" className="btn" style={{ fontSize: 12 }}>Platform Health <ArrowRight size={13} /></Link>
                  </div>
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 20, marginTop: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Server size={14} color={checkingHealth ? "var(--text-faint)" : apiHealth?.ok ? "var(--green)" : "var(--red)"} />
                    <span style={{ fontSize: 13 }}>API / Database</span>
                    <span className={`badge ${checkingHealth ? "gray" : apiHealth?.ok ? "green" : "red"}`}>{checkingHealth ? "…" : apiHealth?.ok ? "Healthy" : "Unreachable"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Radio size={14} color={connected ? "var(--green)" : "var(--amber)"} />
                    <span style={{ fontSize: 13 }}>Live Connection</span>
                    <span className={`badge ${connected ? "green" : "amber"}`}>{connected ? "Connected" : "Reconnecting"}</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <Waves size={14} color={lastEventAt ? "var(--green)" : "var(--text-faint)"} />
                    <span style={{ fontSize: 13 }}>Event Pipeline</span>
                    <span className={`badge ${lastEventAt ? "green" : "gray"}`}>{lastEventAt ? `Last event ${timeAgo(lastEventAt)}` : "No events yet"}</span>
                  </div>
                </div>
              </div>
            </>
          )}

          {activeCategory === "notifications" && (
            <div className="card">
              <h3 className="section-title">Notification Categories</h3>
              <p className="section-sub">
                Real filters, grouped by real event type{" "}
                <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Disabling a category stops its real events from appearing in the bell or counting toward the unread badge; nothing is deleted from Activity Log or device history either way." />
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 8 }}>
                {NOTIFICATION_CATEGORIES.filter((c) => !c.isCatchAll).map((c) => {
                  const enabled = notificationPrefs[c.key] !== false;
                  return (
                    <div key={c.key} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <span style={{ fontSize: 13 }}>{c.label}</span>
                      <button
                        className={`pill-select ${enabled ? "active" : ""}`}
                        onClick={() => toggleNotificationCategory(c.key)}
                      >
                        {enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                  );
                })}
                {(() => {
                  const other = NOTIFICATION_CATEGORIES.find((c) => c.isCatchAll);
                  const enabled = notificationPrefs[other.key] !== false;
                  return (
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 0" }}>
                      <div>
                        <div style={{ fontSize: 13 }}>{other.label}</div>
                        <div style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Anything a device's own local-agent sends that isn't one of the categories above</div>
                      </div>
                      <button
                        className={`pill-select ${enabled ? "active" : ""}`}
                        onClick={() => toggleNotificationCategory(other.key)}
                      >
                        {enabled ? "Enabled" : "Disabled"}
                      </button>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {activeCategory === "monitoring" && (
            <div className="grid grid-split" style={{ gap: 20 }}>
              <div className="card">
                <div className="section-head">
                  <div>
                    <h3 className="section-title">Alert Rules</h3>
                    <p className="section-sub">
                      Real thresholds, evaluated every ~60s{" "}
                      <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="A rule fires once on breach, then again only once it genuinely clears — never repeatedly while a value keeps hovering near the threshold." />
                    </p>
                  </div>
                  <BellRing size={18} color="var(--text-faint)" />
                </div>

                {rulesLoading && <div className="empty-note">Loading alert rules…</div>}
                {!rulesLoading && rulesError && <div className="empty-note" style={{ color: "var(--red)" }}>Couldn't load alert rules: {rulesError}</div>}
                {!rulesLoading && !rulesError && (
                  <div className="table-scroll" style={{ marginBottom: 16 }}>
                    <table className="data-table">
                      <thead><tr><th>Metric</th><th>Condition</th><th>Severity</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
                      <tbody>
                        {rules.map((r) => (
                          <tr key={r.id}>
                            <td style={{ fontWeight: 600 }}>{METRIC_LABELS[r.metric] || r.metric}</td>
                            <td className="mono">{r.operator} {r.threshold}%</td>
                            <td><span className={`badge ${r.severity === "critical" ? "red" : "amber"}`}>{r.severity}</span></td>
                            <td><span className={`badge ${r.enabled ? "green" : "gray"}`}>{r.enabled ? "Enabled" : "Disabled"}</span></td>
                            <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(r.createdAt)}</td>
                            <td>
                              <div style={{ display: "flex", gap: 6 }}>
                                <button className="btn" disabled={busyRuleId === r.id} onClick={() => handleToggleRule(r)}>
                                  {r.enabled ? "Disable" : "Enable"}
                                </button>
                                <button className="btn danger" disabled={busyRuleId === r.id} onClick={() => handleDeleteRule(r)} aria-label="Delete rule">
                                  <Trash2 size={13} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        ))}
                        {rules.length === 0 && <tr><td colSpan={6} className="empty-note">No alert rules configured yet.</td></tr>}
                      </tbody>
                    </table>
                  </div>
                )}

                <form onSubmit={handleCreateRule} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, paddingTop: 12, borderTop: "1px solid var(--border-soft)" }}>
                  <select className="pill-select" value={newMetric} onChange={(e) => {
                    const metric = e.target.value;
                    setNewMetric(metric);
                    setNewOperator(METRIC_OPTIONS.find((m) => m.value === metric)?.defaultOperator || ">");
                  }}>
                    {METRIC_OPTIONS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                  </select>
                  <select className="pill-select" value={newOperator} onChange={(e) => setNewOperator(e.target.value)}>
                    <option value=">">greater than</option>
                    <option value="<">less than</option>
                  </select>
                  <input
                    type="number" min={0} max={100} step={1}
                    className="search-box" style={{ width: 90, border: "1px solid var(--border-soft)" }}
                    value={newThreshold} onChange={(e) => setNewThreshold(e.target.value)}
                  />
                  <span style={{ fontSize: 13, color: "var(--text-dim)" }}>%</span>
                  <select className="pill-select" value={newSeverity} onChange={(e) => setNewSeverity(e.target.value)}>
                    <option value="warning">Warning</option>
                    <option value="critical">Critical</option>
                  </select>
                  <button className="btn primary" type="submit" disabled={creating}>
                    {creating ? "Adding…" : "Add Rule"}
                  </button>
                </form>
              </div>

              <div className="card">
                <div className="section-head">
                  <div>
                    <h3 className="section-title">Offline Detection</h3>
                    <p className="section-sub">
                      How long before a silent device is flagged offline{" "}
                      <Info size={12} color="var(--text-faint)" style={{ cursor: "help", verticalAlign: -2 }} title="Real, persisted setting. Changes take effect on the next 60s liveness sweep — no restart needed." />
                    </p>
                  </div>
                  <WifiOff size={18} color="var(--text-faint)" />
                </div>

                {loading && <div className="empty-note">Loading current threshold…</div>}
                {!loading && loadError && <div className="empty-note" style={{ color: "var(--red)" }}>Couldn't load offline threshold: {loadError}</div>}
                {!loading && !loadError && (
                  <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 10, marginTop: 8 }}>
                    <input
                      type="number"
                      min={1}
                      max={60}
                      step={1}
                      className="search-box"
                      style={{ width: 100, border: "1px solid var(--border-soft)" }}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                    />
                    <span style={{ fontSize: 13, color: "var(--text-dim)" }}>minutes</span>
                    <button className="btn primary" onClick={handleSave} disabled={saving || !dirty}>
                      {saving ? "Saving…" : "Save"}
                    </button>
                    {!dirty && <span style={{ fontSize: 11.5, color: "var(--text-faint)" }}>Currently {threshold} minute{threshold !== 1 ? "s" : ""}</span>}
                  </div>
                )}
              </div>
            </div>
          )}

          {activeCategory === "security" && <ChainIntegrityCard />}

          {activeCategory === "activity" && (
            <>
              <div className="card" style={{ marginBottom: 20 }}>
                <div className="section-head">
                  <div>
                    <h3 className="section-title">Recent Activity</h3>
                    <p className="section-sub">The last 10 real events, tenant-wide — same live buffer Activity / Audit reads</p>
                  </div>
                  <Link to="/help-desk" className="btn" style={{ fontSize: 12 }}>View Full Activity / Audit <ArrowRight size={13} /></Link>
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {events.slice(0, 10).map((e) => (
                    <div key={e.id} style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, padding: "8px 0", borderBottom: "1px solid var(--border-soft)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                        <span className={`badge ${e.severity === "critical" ? "red" : e.severity === "warning" ? "amber" : "blue"}`} style={{ flexShrink: 0 }}>{e.severity}</span>
                        <span className="truncate" style={{ fontSize: 12.5, maxWidth: 260 }} title={e.message}>{e.message}</span>
                        <span className="mono" style={{ fontSize: 11, color: "var(--text-faint)", flexShrink: 0 }}>{devices.find((d) => d.id === e.deviceId)?.hostname || e.deviceId}</span>
                      </div>
                      <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", flexShrink: 0 }}>{formatWithPrefs(e.createdAt, prefs)}</span>
                    </div>
                  ))}
                  {events.length === 0 && <div className="empty-note">No events yet.</div>}
                </div>
              </div>

              <div className="card">
                <h3 className="section-title" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                  Data Retention
                  <Info size={13} color="var(--text-faint)" style={{ cursor: "help" }} title="Real, fixed backend policy (backend/models.go) — not editable here, since it isn't a client-side preference. Applied automatically after every real event this backend records." />
                </h3>
                <p className="section-sub" style={{ marginTop: 6 }}>
                  Events are pruned after <strong style={{ color: "var(--text-dim)" }}>90 days</strong> or <strong style={{ color: "var(--text-dim)" }}>200 events</strong> per device, whichever comes first.
                </p>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 20 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "14px 4px" }}>
          <SlidersHorizontal size={18} color="var(--text-faint)" style={{ flexShrink: 0 }} />
          <p className="section-sub" style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
            <strong style={{ color: "var(--text-dim)" }}>No further configuration yet</strong>
            <Info size={12} color="var(--text-faint)" style={{ cursor: "help" }} title="User roles, SLA policies, and third-party integrations aren't built yet, so nothing further is shown here rather than presenting non-functional placeholder links." />
          </p>
        </div>
      </div>
    </div>
  );
}
