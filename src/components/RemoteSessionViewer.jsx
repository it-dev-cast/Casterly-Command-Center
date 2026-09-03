import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Square, Play, Mic, MicOff, PauseCircle, Download, AlertTriangle, Clock, Monitor, MessageSquare, Radio } from "lucide-react";
import { BACKEND_URL } from "../lib/api.js";

const ICE_SERVERS = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };
const CONNECT_TIMEOUT_MS = 15000;
const FILE_CHUNK_SIZE = 16 * 1024;
const MAX_FILE_SIZE = 25 * 1024 * 1024;
const BUFFERED_AMOUNT_HIGH_WATERMARK = 1024 * 1024;

function toWsUrl(httpUrl) {
  return httpUrl.replace(/^http/, "ws");
}

function waitForIceGatheringComplete(pc, timeoutMs = 8000) {
  if (pc.iceGatheringState === "complete") return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      pc.removeEventListener("icegatheringstatechange", onChange);
      resolve();
    };
    const onChange = () => {
      if (pc.iceGatheringState === "complete") finish();
    };
    pc.addEventListener("icegatheringstatechange", onChange);
    setTimeout(finish, timeoutMs);
  });
}

function setupDataChannel(dc, onOpenChange, onChatMessage, onFileReceived, onVideoPauseChange) {
  dc.binaryType = "arraybuffer";
  let incoming = null;

  dc.onopen = () => onOpenChange(true);
  dc.onclose = () => onOpenChange(false);
  dc.onerror = () => onOpenChange(false);
  dc.onmessage = (event) => {
    if (typeof event.data === "string") {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.kind === "chat") {
        onChatMessage({ text: msg.text, from: msg.from, at: msg.at });
      } else if (msg.kind === "file-start") {
        incoming = { id: msg.id, name: msg.name, mimeType: msg.mimeType, chunks: [] };
      } else if (msg.kind === "file-end" && incoming && incoming.id === msg.id) {
        const blob = new Blob(incoming.chunks, { type: incoming.mimeType || "application/octet-stream" });
        onFileReceived({ name: incoming.name, mimeType: incoming.mimeType, url: URL.createObjectURL(blob), receivedAt: Date.now() });
        incoming = null;
      } else if (msg.kind === "video-pause") {
        onVideoPauseChange?.(!!msg.paused);
      }
    } else if (incoming) {
      incoming.chunks.push(event.data);
    }
  };
}

async function sendFileOverChannel(dc, file, from, onProgress) {
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large - this session supports up to ${Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB per transfer.`);
  }
  const id = `${from}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  dc.send(JSON.stringify({ kind: "file-start", id, name: file.name, size: file.size, mimeType: file.type || "application/octet-stream" }));

  const buf = await file.arrayBuffer();
  let offset = 0;
  while (offset < buf.byteLength) {
    if (dc.bufferedAmount > BUFFERED_AMOUNT_HIGH_WATERMARK) {
      await new Promise((resolve) => {
        const check = () => {
          if (dc.bufferedAmount <= BUFFERED_AMOUNT_HIGH_WATERMARK) resolve();
          else setTimeout(check, 50);
        };
        check();
      });
    }
    dc.send(buf.slice(offset, offset + FILE_CHUNK_SIZE));
    offset += FILE_CHUNK_SIZE;
    onProgress(Math.min(100, Math.round((offset / buf.byteLength) * 100)));
  }
  dc.send(JSON.stringify({ kind: "file-end", id }));
}

const MODE_TEXT = { screen: "Screen Share", voice: "Voice + Chat", chat: "Chat Only" };

export default function RemoteSessionViewer({ sessionId, onClose, hostname, mode = "screen", deviceId, stillInQueue }) {
  const [status, setStatus] = useState("connecting");
  const [connectedAt, setConnectedAt] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState(null);
  const [connectionState, setConnectionState] = useState("none");
  const [timedOut, setTimedOut] = useState(false);
  const [needsManualPlay, setNeedsManualPlay] = useState(false);
  const [hasRemoteVideo, setHasRemoteVideo] = useState(false);
  const [remotePaused, setRemotePaused] = useState(false);

  const [micEnabled, setMicEnabled] = useState(false);
  const [micError, setMicError] = useState(null);
  const [dataChannelOpen, setDataChannelOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [sendingFileProgress, setSendingFileProgress] = useState(null);
  const [fileSendError, setFileSendError] = useState(null);
  const [receivedFiles, setReceivedFiles] = useState([]);
  const [signaling, setSignaling] = useState("connecting");

  const pcRef = useRef(null);
  const wsRef = useRef(null);
  const micStreamRef = useRef(null);
  const remoteStreamRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const connectTimerRef = useRef(null);
  const dcRef = useRef(null);
  const fileInputRef = useRef(null);
  const chatLogRef = useRef(null);
  // Mirrors receivedFiles so the WebSocket effect's cleanup (below, deps=[sessionId] only) can
  // read the CURRENT list of blob URLs to revoke instead of the empty array it closed over at
  // mount - receivedFiles itself isn't a dep of that effect (adding it would tear down/recreate
  // the whole WebRTC connection every time a file arrives), so without this ref the cleanup's
  // URL.revokeObjectURL calls silently never revoked anything.
  const receivedFilesRef = useRef([]);

  function getOrCreateRemoteStream() {
    if (!remoteStreamRef.current) remoteStreamRef.current = new MediaStream();
    return remoteStreamRef.current;
  }

  function attachRemoteStreamToVideo() {
    const video = remoteVideoRef.current;
    const stream = remoteStreamRef.current;
    if (!video || !stream || video.srcObject === stream) return;
    video.srcObject = stream;
    video.play().catch(() => setNeedsManualPlay(true));
  }

  useEffect(() => {
    if (status === "answer-ready") attachRemoteStreamToVideo();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  useEffect(() => {
    receivedFilesRef.current = receivedFiles;
  }, [receivedFiles]);

  useEffect(() => {
    const el = chatLogRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  function armConnectTimeout() {
    if (connectTimerRef.current != null) window.clearTimeout(connectTimerRef.current);
    setTimedOut(false);
    connectTimerRef.current = window.setTimeout(() => {
      const pc = pcRef.current;
      if (pc && pc.connectionState !== "connected") setTimedOut(true);
    }, CONNECT_TIMEOUT_MS);
  }

  function attachConnectionStateTracking(pc) {
    pc.onconnectionstatechange = () => {
      setConnectionState(pc.connectionState);
      if (pc.connectionState === "connected") {
        setError(null);
        setConnectedAt((prev) => prev ?? Date.now());
        if (connectTimerRef.current != null) {
          window.clearTimeout(connectTimerRef.current);
          connectTimerRef.current = null;
          setTimedOut(false);
        }
      }
    };
    pc.ontrack = (event) => {
      const combined = getOrCreateRemoteStream();
      if (!combined.getTracks().includes(event.track)) combined.addTrack(event.track);
      if (event.track.kind === "video") setHasRemoteVideo(true);
      attachRemoteStreamToVideo();
    };
  }

  async function acquireMicAndAddTrack(pc) {
    setMicError(null);
    try {
      const micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = micStream;
      micStream.getTracks().forEach((track) => pc.addTrack(track, micStream));
      setMicEnabled(true);
    } catch (e) {
      setMicEnabled(false);
      setMicError(e instanceof Error ? `Microphone unavailable: ${e.message} (voice call disabled, screen viewing still works)` : "Microphone unavailable (voice call disabled, screen viewing still works).");
    }
  }

  function toggleMic() {
    const stream = micStreamRef.current;
    if (!stream) return;
    const nextEnabled = !micEnabled;
    stream.getAudioTracks().forEach((t) => (t.enabled = nextEnabled));
    setMicEnabled(nextEnabled);
  }

  function sendChatMessage() {
    const dc = dcRef.current;
    const text = chatInput.trim();
    if (!dc || dc.readyState !== "open" || !text) return;
    const msg = { text, from: "operator", at: Date.now() };
    dc.send(JSON.stringify({ kind: "chat", ...msg }));
    setChatMessages((prev) => [...prev, msg]);
    setChatInput("");
  }

  async function handleSendFile(file) {
    const dc = dcRef.current;
    if (!file || !dc || dc.readyState !== "open") return;
    setFileSendError(null);
    setSendingFileProgress(0);
    try {
      await sendFileOverChannel(dc, file, "operator", setSendingFileProgress);
    } catch (e) {
      setFileSendError(e instanceof Error ? e.message : "File transfer failed.");
    } finally {
      setSendingFileProgress(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleOffer(offerSdp, ws) {
    setStatus("answering");
    const pc = new RTCPeerConnection(ICE_SERVERS);
    pcRef.current = pc;
    attachConnectionStateTracking(pc);
    pc.ondatachannel = (event) => {
      dcRef.current = event.channel;
      setupDataChannel(
        event.channel, setDataChannelOpen,
        (msg) => setChatMessages((prev) => [...prev, msg]),
        (file) => setReceivedFiles((prev) => [...prev, file]),
        setRemotePaused,
      );
    };
    // Chat Only has no mic/screen prompt, matching ScreenSharePOC.tsx's own mode !== "chat"
    // check on the customer side - an operator joining a chat-only session shouldn't hit an
    // unexpected microphone permission prompt the UI never promised for this mode.
    if (mode !== "chat") await acquireMicAndAddTrack(pc);

    try {
      await pc.setRemoteDescription(new RTCSessionDescription(offerSdp));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await waitForIceGatheringComplete(pc);
    } catch (e) {
      setError(e instanceof Error ? `Failed to create answer: ${e.message}` : "Failed to create answer.");
      setStatus("connecting");
      return;
    }

    ws.send(JSON.stringify({ type: "answer", sdp: pc.localDescription }));
    setStatus("answer-ready");
    armConnectTimeout();
  }

  useEffect(() => {
    const ws = new WebSocket(`${toWsUrl(BACKEND_URL)}/v1/remote-sessions/${sessionId}/ws`);
    wsRef.current = ws;
    setSignaling("connecting");
    ws.onopen = () => setSignaling("open");
    ws.onclose = () => setSignaling("closed");
    ws.onerror = () => {
      setSignaling("closed");
      setError("Failed to connect to the signaling server for this session (backend unreachable, or the session has expired).");
    };
    ws.onmessage = (event) => {
      setError(null);
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.type === "offer" && msg.sdp) handleOffer(msg.sdp, ws);
    };

    return () => {
      if (connectTimerRef.current != null) window.clearTimeout(connectTimerRef.current);
      pcRef.current?.close();
      wsRef.current?.close();
      dcRef.current?.close();
      micStreamRef.current?.getTracks().forEach((t) => t.stop());
      receivedFilesRef.current.forEach((f) => URL.revokeObjectURL(f.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  const stateColor = {
    none: "var(--text-faint)", new: "var(--text-faint)", connecting: "var(--amber)",
    connected: "var(--green)", disconnected: "var(--amber)", failed: "var(--red)", closed: "var(--text-faint)",
  };
  const isConnected = connectionState === "connected";

  useEffect(() => {
    if (!isConnected || connectedAt == null) return;
    const interval = setInterval(() => setElapsed(Math.floor((Date.now() - connectedAt) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [isConnected, connectedAt]);

  function formatDuration(totalSeconds) {
    const m = Math.floor(totalSeconds / 60);
    const s = totalSeconds % 60;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  const webrtcLabel = isConnected ? "Connected"
    : connectionState === "failed" ? "Failed"
    : connectionState === "closed" ? "Disconnected"
    : connectionState === "disconnected" ? "Reconnecting"
    : "Connecting";
  const webrtcTone = isConnected ? "ok" : (connectionState === "failed" || connectionState === "closed" ? "bad" : "wait");
  const screenLabel = remotePaused ? "Paused" : hasRemoteVideo ? "Live" : (mode === "screen" ? "Waiting" : "Off");
  const screenTone = remotePaused ? "wait" : hasRemoteVideo ? "ok" : "muted";

  return (
    <div className="card ra-session">
      <div className="section-head">
        <div>
          <h3 className="section-title">{hostname || "Remote session"}</h3>
          <p className="section-sub" style={{ margin: 0 }}>
            {MODE_TEXT[mode] || MODE_TEXT.screen}
            {deviceId ? <> · <Link to={`/endpoints/${deviceId}`} style={{ color: "var(--accent)" }}>{deviceId}</Link></> : null}
            {" · "}{sessionId}
            {isConnected ? ` · ${formatDuration(elapsed)}` : ""}
            {stillInQueue === false ? " · left the queue" : ""}
          </p>
        </div>
        <button type="button" className="btn danger" onClick={onClose}>
          <Square size={13} /> Disconnect
        </button>
      </div>

      <div className="ra-status-rail ra-status-rail-tight">
        <span className={`ra-chip ${signaling === "open" ? "ok" : signaling === "closed" ? "bad" : "wait"}`}>
          <Radio size={13} /> Signaling · {signaling === "open" ? "Open" : signaling === "closed" ? "Closed" : "Connecting"}
        </span>
        <span className={`ra-chip ${webrtcTone}`}>
          <span className="ra-chip-dot" style={{ background: stateColor[connectionState] || "var(--text-faint)" }} />
          WebRTC · {webrtcLabel}
        </span>
        <span className={`ra-chip ${dataChannelOpen ? "ok" : "wait"}`}>
          <MessageSquare size={13} /> Chat · {dataChannelOpen ? "Open" : "Connecting"}
        </span>
        <span className={`ra-chip ${screenTone}`}>
          <Monitor size={13} /> Screen · {screenLabel}
        </span>
        <span className={`ra-chip ${micEnabled ? "ok" : "muted"}`}>
          {micEnabled ? <Mic size={13} /> : <MicOff size={13} />} Mic · {micEnabled ? "On" : "Off"}
        </span>
      </div>

      {error && (
        <div className="callout red" style={{ marginBottom: 12 }}>
          <AlertTriangle size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>{error}</span>
        </div>
      )}

      {timedOut && (
        <div className="callout amber" style={{ marginBottom: 12 }}>
          <Clock size={15} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>
            Didn't reach Connected within {CONNECT_TIMEOUT_MS / 1000}s — STUN may not traverse this network (no TURN relay is configured).
          </span>
        </div>
      )}

      {status !== "answer-ready" && !error && (
        <div className="empty-note">
          {signaling === "connecting" || status === "connecting"
            ? "Connecting to the signaling session…"
            : "Offer received — creating answer…"}
        </div>
      )}

      {status === "answer-ready" && (
        <div className="ra-console">
          <div className="ra-stage">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              onLoadedMetadata={attachRemoteStreamToVideo}
              style={{ width: "100%", borderRadius: "var(--radius)", background: "var(--bg)", maxHeight: 480, objectFit: "contain", display: hasRemoteVideo && !remotePaused ? "block" : "none" }}
            />
            {(!hasRemoteVideo || remotePaused) && (
              <div className="ra-stage-empty">
                {remotePaused ? <PauseCircle size={22} /> : <Mic size={22} />}
                <div>
                  {remotePaused
                    ? "Endpoint paused screen sharing"
                    : "Voice/chat only — this endpoint is not sharing a screen"}
                </div>
              </div>
            )}
            {hasRemoteVideo && !remotePaused && needsManualPlay && (
              <button
                type="button"
                onClick={() => remoteVideoRef.current?.play().then(() => setNeedsManualPlay(false)).catch(() => {})}
                className="btn primary ra-play-btn"
              >
                <Play size={16} /> Click to play
              </button>
            )}
          </div>

          <div className="ra-comms">
            <div className="ra-comms-toolbar">
              <button
                type="button"
                onClick={toggleMic}
                disabled={!micStreamRef.current}
                className="btn"
                style={micEnabled ? { borderColor: "var(--accent)", color: "var(--accent)" } : undefined}
              >
                {micEnabled ? <Mic size={14} /> : <MicOff size={14} />} {micEnabled ? "Mic On" : "Mic Off"}
              </button>
              {micError && <span style={{ fontSize: 11, color: "var(--amber)" }}>{micError}</span>}
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Chat</div>
            <div ref={chatLogRef} className="ra-chat-log">
              {chatMessages.length === 0 && <div className="empty-note" style={{ padding: 0 }}>No messages yet.</div>}
              {chatMessages.map((m, i) => (
                <div key={`${m.at}-${i}`} className={`ra-chat-bubble ${m.from === "operator" ? "mine" : ""}`}>
                  <div className="ra-chat-from">{m.from === "operator" ? "You" : m.from}</div>
                  {m.text}
                </div>
              ))}
            </div>
            <div className="ra-chat-compose">
              <input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  e.stopPropagation();
                  if (e.key === "Enter") {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                disabled={!dataChannelOpen}
                placeholder={dataChannelOpen ? "Type a message…" : "Waiting for chat channel…"}
                className="ra-chat-input"
                autoComplete="off"
              />
              <button type="button" className="btn primary" onClick={sendChatMessage} disabled={!dataChannelOpen || !chatInput.trim()}>Send</button>
            </div>

            <div style={{ fontSize: 12, fontWeight: 700, margin: "12px 0 6px" }}>File transfer · up to {Math.round(MAX_FILE_SIZE / 1024 / 1024)}MB</div>
            {fileSendError && <div style={{ fontSize: 11.5, color: "var(--red)", marginBottom: 6 }}>{fileSendError}</div>}
            <input
              ref={fileInputRef}
              type="file"
              disabled={!dataChannelOpen || sendingFileProgress != null}
              onChange={(e) => handleSendFile(e.target.files?.[0])}
              style={{ fontSize: 11.5 }}
            />
            {sendingFileProgress != null && <span className="mono" style={{ fontSize: 11.5, color: "var(--text-faint)", marginLeft: 8 }}>Sending… {sendingFileProgress}%</span>}
            {receivedFiles.length > 0 && (
              <div style={{ marginTop: 8 }}>
                {receivedFiles.map((f, i) => (
                  <a key={`${f.receivedAt}-${i}`} href={f.url} download={f.name} className="ra-file-link">
                    <Download size={13} /> {f.name}
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
