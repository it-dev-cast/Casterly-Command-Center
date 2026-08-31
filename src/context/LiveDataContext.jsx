import { createContext, useContext, useEffect, useRef, useState, useCallback } from "react";
import { api } from "../lib/api.js";
import { subscribeTenantStream } from "../lib/sse.js";
import { formatEventLine } from "../lib/liveDetail.js";

const LiveDataContext = createContext(null);
const TOKEN_STORAGE_KEY = "casterly_admin_token";

// Named so getUsageColor below and healthFromLiveStatus share one real source for each
// threshold instead of two independently-hardcoded copies of the same numbers that could quietly
// drift apart later. CPU/Disk are the exact numbers healthFromLiveStatus already used before
// these constants existed - unchanged, just named. RAM has no separately-established threshold
// anywhere in this codebase (it isn't even part of healthFromLiveStatus's own formula below) -
// reuses CPU's numbers rather than inventing a new pair from nothing, since both are "%
// utilization, higher = worse" metrics of the same shape.
export const CPU_USAGE_THRESHOLDS = { warning: 80, critical: 95 };
export const RAM_USAGE_THRESHOLDS = CPU_USAGE_THRESHOLDS;
export const DISK_USAGE_THRESHOLDS = { warning: 75, critical: 90 };

// healthFromLiveStatus mirrors the same thresholds used throughout this dashboard's design -
// this backend stores raw percentages only (see live.go's LiveStatus), it doesn't compute a
// health label itself, so the label is derived here, client-side, the same way this UI would
// derive it from any other raw metrics source.
export function healthFromLiveStatus(status) {
  if (!status) return "unknown";
  const { cpuPct, ramPct, diskPct, batteryPct } = status;
  if (cpuPct == null && ramPct == null && diskPct == null && batteryPct == null) return "unknown";
  if ((diskPct ?? 0) > DISK_USAGE_THRESHOLDS.critical || (batteryPct ?? 100) < 10 || (cpuPct ?? 0) > CPU_USAGE_THRESHOLDS.critical) return "critical";
  if ((diskPct ?? 0) > DISK_USAGE_THRESHOLDS.warning || (batteryPct ?? 100) < 25 || (cpuPct ?? 0) > CPU_USAGE_THRESHOLDS.warning) return "warning";
  return "healthy";
}

// getBatteryColor is this dashboard's one real battery-charge color rule - green above 50%, amber
// from 20% up to 50%, red below 20% - reused everywhere batteryPct is rendered (Dashboard,
// Endpoints, DeviceDetail) instead of each place re-deriving its own thresholds. Uses the same
// --green/--amber/--red tokens every other tone in this app already uses (badges, StatCards,
// health dots), not new colors. null/undefined (no live reading yet) renders as the same
// --text-faint used for every other "no data" case in this codebase.
export function getBatteryColor(percent) {
  if (percent == null) return "var(--text-faint)";
  if (percent > 50) return "var(--green)";
  if (percent >= 20) return "var(--amber)";
  return "var(--red)";
}

// getUsageColor is getBatteryColor's "higher = worse" counterpart - CPU/RAM/Disk % where high
// usage is the bad direction (the opposite of battery charge). Found uncolored: Dashboard's and
// Endpoints' device tables, and DeviceDetail's KPI cards, all rendered CPU/RAM/Disk as plain
// text right next to a properly-colored Battery % - this fixes that gap using the exact
// thresholds healthFromLiveStatus already establishes above, not new ones, and the same
// --green/--amber/--red tokens getBatteryColor already uses.
export function getUsageColor(percent, thresholds) {
  if (percent == null) return "var(--text-faint)";
  if (percent > thresholds.critical) return "var(--red)";
  if (percent > thresholds.warning) return "var(--amber)";
  return "var(--green)";
}

// getUsageTextColor/getBatteryTextColor - same real thresholds as above, but pointing at the
// --green-text/--amber-text/--red-text tokens (dark-only lighter tints, see index.css's own
// comment on why bare inline table text needs to read brighter than a badge fill, without
// pushing the shared --green/--amber/--red tokens themselves past where they were tuned for
// glow/contrast). Falls back to the regular tokens in light theme, where those -text variants
// aren't defined (light's status colors are already at their readable-on-white ceiling).
export function getUsageTextColor(percent, thresholds) {
  if (percent == null) return "var(--text-faint)";
  if (percent > thresholds.critical) return "var(--red-text, var(--red))";
  if (percent > thresholds.warning) return "var(--amber-text, var(--amber))";
  return "var(--green-text, var(--green))";
}
export function getBatteryTextColor(percent) {
  if (percent == null) return "var(--text-faint)";
  if (percent > 50) return "var(--green-text, var(--green))";
  if (percent >= 20) return "var(--amber-text, var(--amber))";
  return "var(--red-text, var(--red))";
}

// getSeverityTone maps an event/notification severity to this dashboard's existing red/amber/blue
// convention (see Dashboard.jsx's and DeviceDetail.jsx's own event-severity badges, which already
// use this exact mapping inline) - centralized so a new consumer (NotificationBell) agrees with
// them instead of re-deriving the same ternary again. schema.sql's own CHECK constraint on
// events.severity only allows info/warning/critical today, but this doesn't hard-assume that:
// anything other than critical/warning falls through to the same "info" tone, so an unrecognized
// future value degrades gracefully instead of rendering unstyled.
export function getSeverityTone(severity) {
  if (severity === "critical") return "red";
  if (severity === "warning") return "amber";
  return "blue";
}

export function LiveDataProvider({ children }) {
  const [token, setToken] = useState(() => localStorage.getItem(TOKEN_STORAGE_KEY));
  const [authError, setAuthError] = useState(null);
  const [devices, setDevices] = useState([]);
  const [liveStatusByDevice, setLiveStatusByDevice] = useState({}); // deviceId -> LiveStatus
  const [events, setEvents] = useState([]);
  const [notifications, setNotifications] = useState([]);
  const [connected, setConnected] = useState(false);
  const [toasts, setToasts] = useState([]);
  const [recentDeviceIds, setRecentDeviceIds] = useState(new Set());
  const toastIdRef = useRef(0);
  const hostnameByDeviceRef = useRef({});
  const healthByDeviceRef = useRef({});

  useEffect(() => {
    hostnameByDeviceRef.current = Object.fromEntries(devices.map((d) => [d.id, d.hostname]));
  }, [devices]);

  // dismissToast is the one real removal path - both the auto-dismiss timer below and
  // ToastStack's own close button call this, so a manually-closed toast doesn't leave a stale
  // timer trying to remove an already-gone id later (harmless no-op, but one real path is
  // simpler to reason about than two).
  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const pushToast = useCallback((type, title, body, to) => {
    const id = ++toastIdRef.current;
    setToasts((prev) => {
      if (prev.some((t) => t.title === title && t.body === body)) return prev;
      return [...prev, { id, type, title, body, to, time: new Date() }].slice(-3);
    });
    setTimeout(() => dismissToast(id), 8000);
  }, [dismissToast]);

  const flashDevice = useCallback((deviceId) => {
    setRecentDeviceIds((prev) => new Set(prev).add(deviceId));
    setTimeout(() => {
      setRecentDeviceIds((prev) => {
        const next = new Set(prev);
        next.delete(deviceId);
        return next;
      });
    }, 1400);
  }, []);

  const login = useCallback(async (password) => {
    setAuthError(null);
    try {
      const { token: newToken } = await api.login(password);
      localStorage.setItem(TOKEN_STORAGE_KEY, newToken);
      setToken(newToken);
      return true;
    } catch (e) {
      setAuthError(e.message || "Login failed");
      return false;
    }
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    setToken(null);
    setDevices([]);
    setLiveStatusByDevice({});
    setEvents([]);
    setNotifications([]);
    setConnected(false);
  }, []);

  // Initial REST load + SSE subscription whenever we have a token.
  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    async function loadInitial() {
      try {
        const [deviceList, liveStatusList, eventList, notificationList] = await Promise.all([
          api.listDevices(token),
          api.listLiveStatus(token),
          api.listEvents(token, 100),
          api.listNotifications(token),
        ]);
        if (cancelled) return;
        setDevices(deviceList);
        setLiveStatusByDevice(Object.fromEntries(liveStatusList.map((s) => [s.deviceId, s])));
        setEvents(eventList);
        setNotifications(notificationList);
      } catch (e) {
        // A 401 here means the stored token is stale/invalid (e.g. expired after
        // adminSessionDuration, or a secret rotation) - the honest response is to log out back
        // to the login screen, not silently show an empty dashboard. Was previously checked via
        // fragile message-text matching (String(e.message).includes("401")), which almost never
        // actually fired since the backend returns a real JSON error body, not a message
        // containing the literal string "401" - found live, after this failed to trigger during
        // real testing. e.status is now attached directly by request() in api.js.
        if (e.status === 401) logout();
      }
    }
    loadInitial();

    const unsubscribe = subscribeTenantStream(token, {
      onOpen: () => setConnected(true),
      onError: (e) => {
        // Same real gap as loadInitial's own catch: a 401 on the stream (stale/expired token)
        // used to just look identical to a genuine network drop ("Reconnecting..." forever) -
        // now it's actually distinguished, and correctly logs back out to the login screen.
        setConnected(false);
        if (e?.status === 401) logout();
      },
      onMessage: (msg) => {
        if (msg.type === "live-status" && msg.status) {
          const status = msg.status;
          setLiveStatusByDevice((prev) => ({ ...prev, [status.deviceId]: status }));
          flashDevice(status.deviceId);
          const health = healthFromLiveStatus(status);
          const prevHealth = healthByDeviceRef.current[status.deviceId];
          healthByDeviceRef.current[status.deviceId] = health;
          // Only pop when a device newly goes critical — live-status arrives every ~5s, so
          // toasting while it *stays* critical was a popup every poll.
          if (health === "critical" && prevHealth && prevHealth !== "critical") {
            const hostname = hostnameByDeviceRef.current[status.deviceId] || status.deviceId;
            const parts = [
              status.cpuPct != null ? `CPU ${status.cpuPct}%` : null,
              status.diskPct != null ? `Disk ${status.diskPct}%` : null,
              status.ramPct != null ? `RAM ${status.ramPct}%` : null,
            ].filter(Boolean);
            pushToast("alert", hostname, parts.join(" · ") || "Critical", `/endpoints/${status.deviceId}`);
          }
        } else if (msg.type === "event" && msg.event) {
          const event = msg.event;
          setEvents((prev) => [event, ...prev].slice(0, 200));
          setNotifications((prev) => [{ ...event, read: false }, ...prev].slice(0, 50));
          const isRemoteAssist = event.eventType === "remote-assist-requested";
          const isCritical = event.severity === "critical";
          if (!isRemoteAssist && !isCritical) return;
          const hostname = hostnameByDeviceRef.current[event.deviceId] || event.deviceId;
          const to = isRemoteAssist
            ? `/remote-assist?device=${encodeURIComponent(event.deviceId)}`
            : `/endpoints/${event.deviceId}`;
          pushToast(isCritical ? "alert" : "ticket", hostname, formatEventLine(event.message), to);
        }
      },
    });

    return () => {
      cancelled = true;
      unsubscribe();
      setConnected(false);
    };
  }, [token, logout, pushToast, flashDevice]);

  const revokeDevice = useCallback(
    async (deviceId) => {
      await api.revokeDevice(token, deviceId);
      setDevices((prev) => prev.map((d) => (d.id === deviceId ? { ...d, status: "revoked" } : d)));
    },
    [token],
  );

  const resetFingerprint = useCallback(
    async (deviceId) => {
      await api.resetFingerprint(token, deviceId);
    },
    [token],
  );

  const setDeviceTags = useCallback(
    async (deviceId, tags) => {
      const result = await api.setDeviceTags(token, deviceId, tags);
      setDevices((prev) => prev.map((d) => (d.id === deviceId ? { ...d, tags: result.tags } : d)));
    },
    [token],
  );

  // Optimistic, unconditional local updates rather than re-fetching the list after each call -
  // both actions apply to every currently-held notification the same way ("all" really does mean
  // all), so there's nothing a server round trip would tell the initiating tab that it doesn't
  // already know.
  const markAllNotificationsRead = useCallback(
    async () => {
      await api.markAllNotificationsRead(token);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
    },
    [token],
  );

  const clearAllNotifications = useCallback(
    async () => {
      await api.clearAllNotifications(token);
      setNotifications([]);
    },
    [token],
  );

  const value = {
    token, authError, login, logout,
    devices, liveStatusByDevice, events, connected,
    toasts, recentDeviceIds, pushToast, dismissToast,
    revokeDevice, resetFingerprint, setDeviceTags,
    notifications, markAllNotificationsRead, clearAllNotifications,
  };

  return <LiveDataContext.Provider value={value}>{children}</LiveDataContext.Provider>;
}

export function useLiveData() {
  const ctx = useContext(LiveDataContext);
  if (!ctx) throw new Error("useLiveData must be used within LiveDataProvider");
  return ctx;
}
