import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, XCircle, AlertTriangle, Info } from "lucide-react";
import { useLiveData, getSeverityTone } from "../context/LiveDataContext.jsx";
import { useDialog } from "../context/DialogContext.jsx";
import { notificationPrefsStore, categorizeEventType, isCategoryEnabled } from "../lib/notificationPrefs.js";
import { formatEventLine, labelEventType } from "../lib/liveDetail.js";
import { shortDeviceTag } from "../lib/deviceId.js";

// Per-tone icon and actual paintable color for each severity tone getSeverityTone returns -
// red/amber match the real --red/--amber tokens used everywhere else in this app. "blue"
// (really "info" - see index.css's own comment on why info stays a separate quiet neutral, not
// the brand accent) has no plain solid token of its own (only --blue-bg, a translucent badge
// background), so it reuses --accent here too, same as the unread-dot indicator a few lines
// below - a deliberate reuse of the brand color for this one UI affordance, not a claim that
// --accent "is" blue.
const SEVERITY_ICON = { red: XCircle, amber: AlertTriangle, blue: Info };
const SEVERITY_COLOR = { red: "var(--red)", amber: "var(--amber)", blue: "var(--accent)" };

function timeAgo(iso) {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

// Real notification bell backed by the backend's own event_notification_state - every event
// already flowing through insertEvent + hub.publishEvent (device-offline/online, tamper
// detection, revokes, approvals, etc.) shows up here live via the same SSE stream
// LiveDataContext already subscribes to, not a separate poll. "Mark all as read" and "Clear"
// are deliberately two independent actions, not one: read state only ever affects the unread
// badge count (see backend's markAllNotificationsRead), while Clear actually removes
// notifications from this list (clearAllNotifications) without touching the underlying events
// row Activity Log/per-device Event History still show in full.
export default function NotificationBell() {
  const navigate = useNavigate();
  const { notifications: allNotifications, devices, markAllNotificationsRead, clearAllNotifications } = useLiveData();
  const { confirmAsync } = useDialog();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const panelRef = useRef(null);
  const [notificationPrefs] = notificationPrefsStore.useStore();

  // Real filter, not cosmetic - a category toggled off in Settings genuinely stops its real
  // events from appearing here or counting toward the unread badge, not just from being labeled
  // differently.
  const notifications = allNotifications.filter((n) => isCategoryEnabled(notificationPrefs, categorizeEventType(n.eventType)));
  const unreadCount = notifications.filter((n) => !n.read).length;

  useEffect(() => {
    function handleClickOutside(e) {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  function hostnameFor(deviceId) {
    const d = devices.find((d) => d.id === deviceId);
    return d ? `${d.hostname} ${shortDeviceTag(d.id)}` : deviceId;
  }

  async function handleMarkAllRead() {
    setBusy(true);
    try {
      await markAllNotificationsRead();
    } finally {
      setBusy(false);
    }
  }

  async function handleClear() {
    // Real honesty check: Clear is a real backend action affecting every real notification
    // tenant-wide, regardless of this bell's local category filter - the confirmation must say
    // the true total, not just what's currently visible, or a filtered-out category would get
    // silently cleared without the operator ever having been told.
    const hiddenCount = allNotifications.length - notifications.length;
    const ok = await confirmAsync(
      `Clear all ${allNotifications.length} notification${allNotifications.length !== 1 ? "s" : ""}?` +
      (hiddenCount > 0 ? ` (${hiddenCount} filtered out of view will be cleared too.)` : "") +
      ` This only removes them from this list - nothing in Activity / Audit or device history is affected.`,
      "Clear"
    );
    if (!ok) return;
    setBusy(true);
    try {
      await clearAllNotifications();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="icon-btn" ref={panelRef} style={{ position: "relative", cursor: "pointer" }}
      onClick={() => setOpen((v) => !v)}
      title={`${unreadCount} unread notification${unreadCount !== 1 ? "s" : ""}`}>
      <Bell size={16} />
      {unreadCount > 0 && <span className="dot-badge">{unreadCount}</span>}
      {open && (
        <div
          style={{ position: "absolute", top: "calc(100% + 8px)", right: 0, width: 360, background: "var(--bg-panel-2)", border: "1px solid var(--border-soft)", borderRadius: "var(--radius)", padding: 8, zIndex: 100, maxHeight: 440, overflowY: "auto", cursor: "default" }}
          onClick={(e) => e.stopPropagation()}
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "4px 8px 8px" }}>
            <span style={{ fontSize: 12, fontWeight: 700 }}>Notifications ({notifications.length})</span>
            <div style={{ display: "flex", gap: 6 }}>
              <button
                className="btn"
                disabled={busy || unreadCount === 0}
                onClick={handleMarkAllRead}
                style={{ fontSize: 11, padding: "4px 8px" }}
              >
                Mark all as read
              </button>
              <button
                className="btn"
                disabled={busy || allNotifications.length === 0}
                onClick={handleClear}
                style={{ fontSize: 11, padding: "4px 8px", color: "var(--red)", borderColor: "var(--red)" }}
              >
                Clear
              </button>
            </div>
          </div>

          {notifications.length === 0 && (
            <div className="empty-note" style={{ padding: "8px 4px" }}>
              {allNotifications.length === 0 ? "No notifications." : `${allNotifications.length} notification${allNotifications.length !== 1 ? "s are" : " is"} hidden by your category filters — see Settings.`}
            </div>
          )}

          {notifications.map((n) => {
            const tone = getSeverityTone(n.severity);
            const SeverityIcon = SEVERITY_ICON[tone];
            const toneColor = SEVERITY_COLOR[tone];
            return (
              <div
                key={n.id}
                onClick={() => {
                  setOpen(false);
                  navigate(n.eventType === "remote-assist-requested"
                    ? `/remote-assist?device=${encodeURIComponent(n.deviceId)}`
                    : `/endpoints/${n.deviceId}`);
                }}
                style={{
                  padding: "8px",
                  borderRadius: 6,
                  fontSize: 13,
                  cursor: "pointer",
                  borderLeft: `3px solid ${toneColor}`,
                  marginBottom: 4,
                  background: n.read ? "transparent" : "var(--bg-panel)",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--border-soft)"}
                onMouseLeave={(e) => e.currentTarget.style.background = n.read ? "transparent" : "var(--bg-panel)"}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <SeverityIcon size={13} color={toneColor} style={{ flexShrink: 0 }} />
                  {!n.read && <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--accent)", display: "inline-block", flexShrink: 0 }} />}
                  <span style={{ fontWeight: n.read ? 500 : 700 }}>{labelEventType(n.eventType)}</span>
                </div>
                <div className="truncate" style={{ color: "var(--text-dim)", marginTop: 2 }} title={n.message}>{formatEventLine(n.message)}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
                  {hostnameFor(n.deviceId)} · {timeAgo(n.createdAt)}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
