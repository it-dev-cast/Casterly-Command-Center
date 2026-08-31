import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, Sun, Moon, Check, ShieldCheck } from "lucide-react";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { TENANT_ID, api } from "../lib/api.js";
import { useTheme, THEME_REGISTRY } from "../hooks/useTheme.js";
import NotificationBell from "./NotificationBell.jsx";

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function OpsClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return <span className="topbar-clock mono">{now.toLocaleTimeString()}</span>;
}

export default function TopBar() {
  const { devices, events, token } = useLiveData();
  const navigate = useNavigate();
  const { theme, toggleTheme, setTheme, family } = useTheme();

  const [query, setQuery] = useState("");
  const [showResults, setShowResults] = useState(false);
  const searchRef = useRef(null);
  const [themeMenuOpen, setThemeMenuOpen] = useState(false);
  const themeMenuRef = useRef(null);

  // Real incident search needs real incident data - useLiveData() doesn't hold incidents (every
  // page that shows them fetches its own copy, same pattern as Incidents.jsx/Reports.jsx/
  // Lifecycle.jsx), so this fetches once here too rather than reaching into another page's local
  // state. Silently empty on failure - search still works for devices/events either way, and
  // this isn't the place to surface a real fetch-error banner.
  const [incidents, setIncidents] = useState([]);
  useEffect(() => {
    if (!token) return;
    api.listIncidents(token).then(setIncidents).catch(() => {});
  }, [token]);

  const q = query.trim().toLowerCase();
  const matchingDevices = q ? devices.filter((d) => d.id.toLowerCase().includes(q) || d.hostname.toLowerCase().includes(q)).slice(0, 5) : [];
  const matchingIncidents = q ? incidents.filter((i) => i.title.toLowerCase().includes(q) || i.deviceId.toLowerCase().includes(q) || i.status.toLowerCase().includes(q)).slice(0, 5) : [];
  // "Alerts" (warning/critical) vs "Activity" (info) mirrors the exact same real distinction
  // this app already draws between Alerts.jsx and HelpDesk.jsx - both views of the one real
  // event log, not two different data sources.
  const matchingAlerts = q ? events.filter((e) => e.severity !== "info" && (e.message.toLowerCase().includes(q) || e.eventType.toLowerCase().includes(q) || e.deviceId.toLowerCase().includes(q))).slice(0, 5) : [];
  const matchingActivity = q ? events.filter((e) => e.severity === "info" && (e.message.toLowerCase().includes(q) || e.eventType.toLowerCase().includes(q) || e.deviceId.toLowerCase().includes(q))).slice(0, 5) : [];
  const hasResults = matchingDevices.length > 0 || matchingIncidents.length > 0 || matchingAlerts.length > 0 || matchingActivity.length > 0;

  useEffect(() => {
    function handleClickOutside(e) {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowResults(false);
      if (themeMenuRef.current && !themeMenuRef.current.contains(e.target)) setThemeMenuOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const isDarkFamily = family === "dark";

  function goTo(path) {
    setShowResults(false);
    setQuery("");
    navigate(path);
  }

  function ResultGroup({ title, items, renderItem }) {
    if (items.length === 0) return null;
    return (
      <>
        <div style={{ fontSize: 11, color: "var(--text-faint)", padding: "4px 8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>{title}</div>
        {items.map(renderItem)}
      </>
    );
  }

  return (
    <header className="topbar">
      <div className="search-box" ref={searchRef} style={{ position: "relative" }}>
        <Search size={15} />
        <input
          value={query}
          onChange={(e) => { setQuery(e.target.value); setShowResults(true); }}
          onFocus={() => setShowResults(true)}
          placeholder="Search devices, incidents, alerts, activity..."
          style={{ background: "transparent", border: "none", outline: "none", color: "inherit", font: "inherit", width: "100%" }}
        />
        {showResults && q && (
          <div style={{ position: "absolute", top: "calc(100% + 6px)", left: 0, width: 380, background: "var(--bg-panel-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 8, zIndex: 100, maxHeight: 440, overflowY: "auto" }}>
            {!hasResults && <div className="empty-note" style={{ padding: "8px 4px" }}>No matches for "{query}"</div>}

            <ResultGroup
              title="Devices"
              items={matchingDevices}
              renderItem={(d) => (
                <div key={d.id} onClick={() => goTo(`/endpoints/${d.id}`)} style={{ padding: "8px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--border-soft)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <div style={{ fontWeight: 600 }}>{d.hostname}</div>
                  <div className="mono" style={{ fontSize: 11, color: "var(--text-faint)" }}>{d.id}</div>
                </div>
              )}
            />
            <ResultGroup
              title="Incidents"
              items={matchingIncidents}
              renderItem={(i) => (
                <div key={i.id} onClick={() => goTo(`/incidents/${i.id}`)} style={{ padding: "8px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--border-soft)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}>
                  <div style={{ fontWeight: 600 }}>{i.title}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{i.status} · {timeAgo(i.createdAt)}</div>
                </div>
              )}
            />
            <ResultGroup
              title="Alerts"
              items={matchingAlerts}
              renderItem={(e) => (
                <div key={e.id} onClick={() => goTo(`/endpoints/${e.deviceId}`)} style={{ padding: "8px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                  onMouseEnter={(ev) => ev.currentTarget.style.background = "var(--border-soft)"}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = "transparent"}>
                  <div>{e.message}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{e.eventType} · {timeAgo(e.createdAt)}</div>
                </div>
              )}
            />
            <ResultGroup
              title="Activity"
              items={matchingActivity}
              renderItem={(e) => (
                <div key={e.id} onClick={() => goTo(`/endpoints/${e.deviceId}`)} style={{ padding: "8px", borderRadius: 6, cursor: "pointer", fontSize: 13 }}
                  onMouseEnter={(ev) => ev.currentTarget.style.background = "var(--border-soft)"}
                  onMouseLeave={(ev) => ev.currentTarget.style.background = "transparent"}>
                  <div>{e.message}</div>
                  <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{e.eventType} · {timeAgo(e.createdAt)}</div>
                </div>
              )}
            />
          </div>
        )}
      </div>
      <div className="topbar-right">
        <OpsClock />
        <div className="icon-btn" ref={themeMenuRef} style={{ position: "relative", cursor: "pointer" }}
          onClick={() => setThemeMenuOpen((v) => !v)}
          title="Change theme"
        >
          {isDarkFamily ? <Sun size={16} /> : <Moon size={16} />}
          {themeMenuOpen && (
            <div className="theme-menu" onClick={(e) => e.stopPropagation()}>
              <div
                className="theme-menu-split"
                onClick={() => { toggleTheme(); setThemeMenuOpen(false); }}
              >
                {isDarkFamily ? <Sun size={14} /> : <Moon size={14} />}
                Switch to {isDarkFamily ? "Light" : "Dark"}
              </div>
              <div className="theme-menu-label">Dark</div>
              {THEME_REGISTRY.filter((t) => t.family === "dark").map((t) => (
                <div
                  key={t.id}
                  className={`theme-menu-row${theme === t.id ? " is-on" : ""}`}
                  onClick={() => { setTheme(t.id); setThemeMenuOpen(false); }}
                >
                  <span className="theme-swatch" aria-hidden="true" style={{ "--swatch-canvas": t.canvas, "--swatch-accent": t.accent }} />
                  <span style={{ flex: 1 }}>{t.label}</span>
                  {theme === t.id && <Check size={13} color="var(--accent)" />}
                </div>
              ))}
              <div className="theme-menu-label">Light</div>
              {THEME_REGISTRY.filter((t) => t.family === "light").map((t) => (
                <div
                  key={t.id}
                  className={`theme-menu-row${theme === t.id ? " is-on" : ""}`}
                  onClick={() => { setTheme(t.id); setThemeMenuOpen(false); }}
                >
                  <span className="theme-swatch" aria-hidden="true" style={{ "--swatch-canvas": t.canvas, "--swatch-accent": t.accent }} />
                  <span style={{ flex: 1 }}>{t.label}</span>
                  {theme === t.id && <Check size={13} color="var(--accent)" />}
                </div>
              ))}
            </div>
          )}
        </div>
        <NotificationBell />
        {/* Real env indicator (which tenant/backend you're looking at) - this backend is
            genuinely single-tenant today (see main.go's own comment), so it's informational, not
            a switcher. No pill/chevron styling here on purpose, since that would visually promise
            a dropdown that isn't one. */}
        <span className="topbar-env-pill mono">{TENANT_ID}</span>
        {/* Real session indicator, not a fabricated named user - this app's real auth model is a
            single shared admin password (see backend/auth.go), not per-user accounts, so "Admin"
            is what's actually true here, not an invented person/avatar. */}
        <span className="topbar-user" title="Signed in as the tenant admin">
          <ShieldCheck size={14} /> Admin
        </span>
      </div>
    </header>
  );
}
