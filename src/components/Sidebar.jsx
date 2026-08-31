import { useEffect, useState } from "react";
import { NavLink } from "react-router-dom";
import {
  LayoutGrid, Monitor, Server, Database, AlertTriangle, RefreshCw,
  Leaf, History, FileText, Settings as SettingsIcon, LogOut, ClipboardCheck, PhoneCall,
  ChevronsLeft, ChevronsRight, Zap, ShieldCheck, ShieldAlert, Sparkles,
} from "lucide-react";
import { useLiveData, healthFromLiveStatus } from "../context/LiveDataContext.jsx";
import { api } from "../lib/api.js";
import { CasterlyMark } from "./CasterlyLogo.jsx";

// Grouped to match the Command Center's real operational flow, per the master UI/UX redesign
// brief's explicit sidebar hierarchy: Overview -> Fleet -> Operations -> Lifecycle ->
// Intelligence -> Business -> Admin. "Activity / Audit" (the real tenant-wide event log
// HelpDesk.jsx has always been) moved from Admin into Operations per that brief's explicit
// current instruction - a deliberate change from the earlier IA pass, not drift. Approvals stays
// under Lifecycle (a lifecycle-stage decision, not incident-triage) and the two real modules
// outside the brief's illustrative list (Infrastructure/Data Centers, Remote Assist) stay
// reachable, demoted below Business - the brief's hierarchy is explicitly a "suggested" one, not
// a mandate to delete real, working pages that aren't named in it. Fleet Analytics intentionally
// NOT added here - it still doesn't exist (per the earlier Fleet Analytics decision).
const NAV_GROUPS = [
  {
    label: "Overview",
    items: [
      { to: "/", label: "Dashboard", icon: LayoutGrid, end: true, badgeKey: "remote" },
      { to: "/action-center", label: "Action Center", icon: Zap },
    ],
  },
  {
    label: "Fleet",
    items: [
      { to: "/endpoints", label: "Endpoints", icon: Monitor },
    ],
  },
  {
    label: "Operations",
    items: [
      { to: "/alerts", label: "Alerts", icon: AlertTriangle, badgeKey: "critical" },
      { to: "/incidents", label: "Incidents", icon: ClipboardCheck },
      { to: "/help-desk", label: "Activity / Audit", icon: History, badgeKey: "warning" },
    ],
  },
  {
    label: "Lifecycle",
    items: [
      { to: "/lifecycle", label: "Lifecycle Management", icon: RefreshCw },
      { to: "/hardware-integrity", label: "Hardware Integrity", icon: ShieldAlert },
      { to: "/approvals", label: "Approvals", icon: ShieldCheck },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { to: "/ai-intelligence", label: "AI Intelligence", icon: Sparkles },
    ],
  },
  {
    label: "Business",
    items: [
      { to: "/reports", label: "Reports", icon: FileText },
      { to: "/esg", label: "ESG & Sustainability", icon: Leaf },
    ],
  },
  {
    label: "Infrastructure",
    secondary: true,
    items: [
      { to: "/infrastructure", label: "Infrastructure", icon: Server },
      { to: "/data-centers", label: "Data Centers", icon: Database },
    ],
  },
  {
    label: "Remote Operations",
    items: [
      { to: "/remote-assist", label: "Remote Assist", icon: PhoneCall, badgeKey: "remote" },
    ],
  },
  {
    label: "Admin",
    items: [
      { to: "/settings", label: "Settings", icon: SettingsIcon },
    ],
  },
];

// Real per-device health tick shown next to its status color - the exact same
// healthFromLiveStatus classification every badge/health column elsewhere in this app already
// uses, not a separate re-derivation that could quietly disagree with them.
const TICK_TITLE = { healthy: "Healthy", warning: "Warning", critical: "Critical", unknown: "No data yet" };
const COLLAPSE_KEY = "casterly_sidebar_collapsed";

export default function Sidebar() {
  const { events, connected, logout, devices, liveStatusByDevice, token } = useLiveData();
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem(COLLAPSE_KEY) === "1";
    } catch {
      return false;
    }
  });
  const [waitingRemoteCount, setWaitingRemoteCount] = useState(0);
  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    function tick() {
      api.listRemoteSessions(token).then((list) => {
        if (!cancelled) setWaitingRemoteCount((Array.isArray(list) ? list : []).filter((s) => (s.peerCount ?? 0) < 2).length);
      }).catch(() => {});
    }
    tick();
    const id = setInterval(tick, 4000);
    return () => { cancelled = true; clearInterval(id); };
  }, [token]);
  const criticalCount = events.filter((e) => e.severity === "critical").length;
  const warningCount = events.filter((e) => e.severity === "warning").length;

  // Fleet Pulse - one real tick per active device, colored by real live health. Pure
  // presentation over data useLiveData() already holds (devices + liveStatusByDevice, both kept
  // live by the same SSE subscription every other page already reacts to) - no new fetch, no new
  // data flow. This IS this app's real "system status" widget - the brief's own separate concept
  // reuses this exact real data rather than inventing a second, parallel summary.
  const activeDevices = devices.filter((d) => d.status === "active");
  const pulseTicks = activeDevices.map((d) => ({
    id: d.id,
    hostname: d.hostname,
    health: healthFromLiveStatus(liveStatusByDevice[d.id]),
  }));
  const healthyCount = pulseTicks.filter((t) => t.health === "healthy").length;
  const attentionCount = pulseTicks.filter((t) => t.health === "warning" || t.health === "critical").length;

  function toggleCollapsed() {
    setCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0");
      } catch {
        // Private-browsing/quota-related storage failure - non-fatal, same as every other
        // localStorage write elsewhere in this app.
      }
      return next;
    });
  }

  const badgeValue = (key) => {
    if (key === "critical") return criticalCount;
    if (key === "warning") return warningCount;
    if (key === "remote") return waitingRemoteCount;
    return null;
  };

  return (
    <aside className={`sidebar ${collapsed ? "collapsed" : ""}`}>
      <div className="brand">
        <div className="brand-mark">
          <CasterlyMark size={collapsed ? 40 : 44} />
        </div>
        {!collapsed && (
          <div>
            <div className="brand-title">CASTERLY</div>
            <div className="brand-sub">Command Centre</div>
          </div>
        )}
      </div>

      <div className="sidebar-scroll">
      {NAV_GROUPS.map((group) => (
        <div key={group.label} className={group.secondary ? "nav-group-secondary" : undefined}>
          {!collapsed && <div className="nav-label">{group.label.toUpperCase()}</div>}
          {group.items.map((item) => {
            const Icon = item.icon;
            const badge = badgeValue(item.badgeKey);
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => "nav-item" + (isActive ? " active" : "")}
                title={collapsed ? item.label : undefined}
              >
                <Icon size={16} />
                {!collapsed && <span>{item.label}</span>}
                {!collapsed && !!badge && <span className="badge red" style={{ marginLeft: "auto", padding: "1px 7px" }}>{badge}</span>}
                {collapsed && !!badge && <span className="nav-item-dot" aria-hidden="true" />}
              </NavLink>
            );
          })}
        </div>
      ))}

      {!collapsed && (
        <div className="pulse-rail-wrap">
          <div className="pulse-rail-head">
            <span className="pulse-rail-title">System Status</span>
            <span className="pulse-rail-count">{pulseTicks.length}</span>
          </div>
          {pulseTicks.length === 0 ? (
            <div className="pulse-rail-empty">No active devices yet.</div>
          ) : (
            <>
              <div className="pulse-rail-ticks">
                {pulseTicks.map((t) => (
                  <span key={t.id} className={`pulse-tick ${t.health}`} title={`${t.hostname}: ${TICK_TITLE[t.health]}`} />
                ))}
              </div>
              <div className="pulse-rail-summary">
                {healthyCount} healthy{attentionCount > 0 ? ` Â· ${attentionCount} need attention` : ""}
              </div>
            </>
          )}
          <div className={"connection-pill " + (connected ? "live" : "offline")}>
            {connected ? "â— Live feed" : "â— Reconnectingâ€¦"}
          </div>
          <button className="btn" onClick={logout} style={{ width: "100%", justifyContent: "center", marginTop: 10 }}>
            <LogOut size={13} /> Sign out
          </button>
        </div>
      )}
      {collapsed && (
        <div className="sidebar-collapsed-footer">
          <span className={`pulse-tick ${attentionCount > 0 ? "critical" : "healthy"}`} title={`${healthyCount} healthy, ${attentionCount} need attention`} />
          <button className="icon-btn" onClick={logout} title="Sign out" aria-label="Sign out">
            <LogOut size={15} />
          </button>
        </div>
      )}
      </div>

      <button className="sidebar-collapse-btn" type="button" onClick={toggleCollapsed} title={collapsed ? "Expand sidebar" : "Collapse sidebar"} aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>
        {collapsed ? <ChevronsRight size={16} /> : <ChevronsLeft size={16} />}
      </button>
    </aside>
  );
}
