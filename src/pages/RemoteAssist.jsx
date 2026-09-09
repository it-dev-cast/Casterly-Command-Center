import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import {
  PhoneCall, Users, Clock, RefreshCw, Monitor, Mic, MessageSquare,
  Radio, Wifi, WifiOff, CircleDot,
} from "lucide-react";
import StatCard from "../components/StatCard.jsx";
import RemoteSessionViewer from "../components/RemoteSessionViewer.jsx";
import { useLiveData, healthFromLiveStatus } from "../context/LiveDataContext.jsx";
import { api } from "../lib/api.js";
import { shortDeviceTag } from "../lib/deviceId.js";

const MODE_ICON = { screen: Monitor, voice: Mic, chat: MessageSquare };
const MODE_TEXT = { screen: "Screen Share", voice: "Voice + Chat", chat: "Chat Only" };
const HEALTH_LABEL = { healthy: "Healthy", warning: "At risk", critical: "Critical", unknown: "No live data" };
const BASE_POLL_MS = 2000;

function timeAgo(iso, nowMs) {
  if (!iso) return "—";
  const s = Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

function secondsAgo(ms, nowMs) {
  if (!ms) return "never";
  const s = Math.max(0, Math.floor((nowMs - ms) / 1000));
  if (s === 0) return "just now";
  if (s < 60) return `${s}s ago`;
  return `${Math.floor(s / 60)}m ago`;
}

export default function RemoteAssist() {
  const { token, connected, events, devices, liveStatusByDevice } = useLiveData();
  const [searchParams] = useSearchParams();
  const focusDevice = searchParams.get("device");
  const [sessions, setSessions] = useState([]);
  const [joinedSessionIds, setJoinedSessionIds] = useState([]);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefreshAt, setLastRefreshAt] = useState(null);
  const [queueError, setQueueError] = useState(null);
  const [nowMs, setNowMs] = useState(Date.now());
  const pollInFlight = useRef(false);

  function joinSession(id) {
    setJoinedSessionIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
  }
  function leaveSession(id) {
    setJoinedSessionIds((prev) => prev.filter((x) => x !== id));
  }

  const poll = useCallback(() => {
    if (!token || pollInFlight.current) return Promise.resolve();
    pollInFlight.current = true;
    return api.listRemoteSessions(token)
      .then((list) => {
        setSessions(Array.isArray(list) ? list : []);
        setLastRefreshAt(Date.now());
        setQueueError(null);
      })
      .catch((e) => setQueueError(e.message || "Failed to load the session queue"))
      .finally(() => { pollInFlight.current = false; });
  }, [token]);

  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!token) return;
    poll();
    const interval = setInterval(poll, BASE_POLL_MS);
    function onVisible() {
      if (document.visibilityState === "visible") poll();
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
    };
  }, [token, poll]);

  // Real event types this endpoint's ScreenSharePOC.tsx actually posts (verified directly -
  // "remote-assist-requested" was never one of them, so this fast-path never fired). No event
  // exists yet for the moment a session is first *created* - these four cover every real
  // lifecycle transition after that (join requested/approved/denied, session ended), so the
  // queue stays in sync promptly for status changes even though brand-new sessions still rely
  // on the interval poll (now uncapped, see above) rather than a push.
  const RELEVANT_REMOTE_EVENT_TYPES = new Set([
    "remote-assist-join-request-received",
    "remote-assist-operator-joined",
    "remote-assist-join-denied",
    "remote-assist-ended",
  ]);
  const latestRemoteEventId = events.find((e) => RELEVANT_REMOTE_EVENT_TYPES.has(e.eventType))?.id;
  useEffect(() => {
    if (!latestRemoteEventId) return;
    poll();
  }, [latestRemoteEventId, poll]);

  useEffect(() => {
    if (!focusDevice) return;
    const match = sessions.find((s) => s.deviceId === focusDevice);
    if (match && !joinedSessionIds.includes(match.id)) joinSession(match.id);
  }, [focusDevice, sessions, joinedSessionIds]);

  async function handleManualRefresh() {
    setRefreshing(true);
    await poll();
    setRefreshing(false);
  }

  const waiting = sessions.filter((s) => (s.peerCount ?? 0) < 2);
  const linked = sessions.filter((s) => (s.peerCount ?? 0) >= 2);
  const screenShareCount = sessions.filter((s) => s.mode === "screen").length;
  const voiceChatCount = sessions.filter((s) => s.mode === "voice").length;
  const chatOnlyCount = sessions.filter((s) => s.mode === "chat").length;
  const hostnameById = useMemo(
    () => Object.fromEntries(devices.map((d) => [d.id, d.hostname])),
    [devices],
  );
  const unjoinedWaiting = waiting.filter((s) => !joinedSessionIds.includes(s.id));

  return (
    <div>
      <div className="ra-page-head">
        <div>
          <h1 className="page-title">Remote Assist</h1>
          <p className="page-sub">Live queue from your fleet — Join opens the real WebRTC session</p>
        </div>
        <div className="ra-status-rail" aria-live="polite">
          <span className={`ra-chip ${connected ? "ok" : "bad"}`}>
            {connected ? <Wifi size={13} /> : <WifiOff size={13} />}
            {connected ? "Live feed" : "Feed reconnecting"}
          </span>
          <span className="ra-chip">
            <Radio size={13} />
            Queue {secondsAgo(lastRefreshAt, nowMs)}
          </span>
          <span className={`ra-chip ${waiting.length > 0 ? "wait" : ""}`}>
            <Clock size={13} />
            {waiting.length} waiting
          </span>
          <span className={`ra-chip ${joinedSessionIds.length > 0 ? "ok" : ""}`}>
            <CircleDot size={13} />
            {joinedSessionIds.length > 0 ? `${joinedSessionIds.length} session${joinedSessionIds.length === 1 ? "" : "s"} open` : "Idle"}
          </span>
        </div>
      </div>

      {unjoinedWaiting.length > 0 && (
        <button
          type="button"
          className="remote-wait-banner"
          onClick={() => joinSession(unjoinedWaiting[0].id)}
        >
          <PhoneCall size={16} />
          <span>
            {unjoinedWaiting.length === 1
              ? `${unjoinedWaiting[0].hostname || hostnameById[unjoinedWaiting[0].deviceId] || "An endpoint"} ${shortDeviceTag(unjoinedWaiting[0].deviceId)} is waiting — ${MODE_TEXT[unjoinedWaiting[0].mode] || "Screen Share"}`
              : `${unjoinedWaiting.length} endpoints waiting for an operator`}
          </span>
          <span className="remote-wait-go">Join →</span>
        </button>
      )}

      <div className="grid grid-3" style={{ marginBottom: 20 }}>
        <StatCard icon={PhoneCall} tone="blue" value={sessions.length} label="Active Sessions" live={connected} />
        <StatCard icon={Clock} tone="amber" value={waiting.length} label="Waiting for Operator" live={connected} />
        <StatCard icon={Users} tone="green" value={linked.length} label="Operator Joined" live={connected} />
        <StatCard icon={Monitor} tone="teal" value={screenShareCount} label="Screen Share" live={connected} />
        <StatCard icon={Mic} tone="purple" value={voiceChatCount} label="Voice + Chat" live={connected} />
        <StatCard icon={MessageSquare} tone="gray" value={chatOnlyCount} label="Chat Only" live={connected} />
      </div>

      {joinedSessionIds.map((id, i) => {
        const session = sessions.find((s) => s.id === id) || null;
        return (
          <div key={id} style={{ marginBottom: i < joinedSessionIds.length - 1 ? 16 : 0 }}>
            <RemoteSessionViewer
              sessionId={id}
              token={token}
              hostname={
                session?.hostname || hostnameById[session?.deviceId]
                  ? `${session?.hostname || hostnameById[session?.deviceId]} ${shortDeviceTag(session?.deviceId)}`
                  : session?.deviceId || "Endpoint"
              }
              mode={session?.mode || "screen"}
              deviceId={session?.deviceId}
              stillInQueue={!!session}
              onClose={() => { leaveSession(id); poll(); }}
            />
          </div>
        );
      })}

      <div className="card" style={{ marginBottom: 16, marginTop: joinedSessionIds.length > 0 ? 16 : 0 }}>
        <div className="section-head">
          <div>
            <h3 className="section-title">Session Queue</h3>
            <p className="section-sub">
              Auto-refreshes every {BASE_POLL_MS / 1000}s while this page is open
              {lastRefreshAt ? ` · last ${secondsAgo(lastRefreshAt, nowMs)}` : ""}
            </p>
          </div>
          <button className="btn" onClick={handleManualRefresh} disabled={refreshing}>
            <RefreshCw size={14} style={{ animation: refreshing ? "spin 0.6s linear infinite" : "none" }} />
            Refresh
          </button>
        </div>

        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr>
                <th>Device</th>
                <th>Hostname</th>
                <th>Health</th>
                <th>Mode</th>
                <th>Requested</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const ModeIcon = MODE_ICON[s.mode] || MODE_ICON.screen;
                const health = healthFromLiveStatus(liveStatusByDevice[s.deviceId]);
                const waitingRow = (s.peerCount ?? 0) < 2;
                return (
                  <tr key={s.id} className={s.deviceId === focusDevice || joinedSessionIds.includes(s.id) ? "flash" : undefined}>
                    <td className="mono" style={{ fontSize: 11.5 }}>
                      <Link to={`/endpoints/${s.deviceId}`} style={{ color: "var(--accent)" }}>{s.deviceId}</Link>
                    </td>
                    <td className="truncate" style={{ fontWeight: 600, maxWidth: 200 }} title={s.hostname}>{s.hostname || hostnameById[s.deviceId] || "—"}</td>
                    <td>
                      <span className={`badge ${health === "critical" ? "red" : health === "warning" ? "amber" : health === "healthy" ? "green" : "gray"}`}>
                        {HEALTH_LABEL[health]}
                      </span>
                    </td>
                    <td>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                        <ModeIcon size={13} /> {MODE_TEXT[s.mode] || MODE_TEXT.screen}
                      </span>
                    </td>
                    <td className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)" }}>{timeAgo(s.createdAt, nowMs)}</td>
                    <td>
                      <span className={`badge ${waitingRow ? "amber" : "green"}`}>
                        {waitingRow ? "Waiting for operator" : "Operator joined"}
                      </span>
                    </td>
                    <td>
                      <button
                        className="btn primary"
                        onClick={() => joinSession(s.id)}
                        disabled={joinedSessionIds.includes(s.id)}
                      >
                        {joinedSessionIds.includes(s.id) ? "Joined" : "Join"}
                      </button>
                    </td>
                  </tr>
                );
              })}
              {queueError && (
                <tr>
                  <td colSpan={7} className="empty-note" style={{ color: "var(--red)" }}>
                    Couldn't refresh the session queue: {queueError}
                  </td>
                </tr>
              )}
              {!queueError && sessions.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty-note">
                    No active remote assist requests. When an endpoint taps Share, it appears here within a couple of seconds.
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
