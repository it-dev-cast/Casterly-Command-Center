// Custom SSE client using fetch() + a streamed response body, NOT the browser's native
// EventSource - EventSource has no way to set custom request headers, so it can't send the
// `Authorization: Bearer <adminToken>` this backend's adminAuthMiddleware requires (see
// handleTenantStream's own comment on why the endpoint is header-authenticated like every
// other admin call rather than accepting a token query param, which would leak the JWT into
// server access logs / browser history for no real benefit).
import { BACKEND_URL, TENANT_ID } from "./api.js";

const INITIAL_RETRY_MS = 1000;
const MAX_RETRY_MS = 30000;

// subscribeTenantStream opens GET /v1/tenants/{id}/stream and calls onMessage(parsedJSON) for
// every real "data: ...\n\n" frame the backend's liveHub publishes (see live.go). Owns real
// reconnection: a dropped connection (network blip, backend restart, proxy timeout, or the
// server just closing its end - reader.read() resolving `done` with no error at all, previously
// left this treated as still "connected" forever) is retried with exponential backoff up to
// MAX_RETRY_MS, not surfaced once and abandoned. onOpen fires again on every successful
// reconnect and onError on every drop, so callers' "connected" state stays honest across
// reconnect cycles instead of only ever reflecting the first attempt. A 401 (stale/expired
// token) stops retrying, since hammering the same bad token can't ever succeed - the caller's
// own onError already logs out on that status, and a fresh subscribe happens naturally once a
// new token exists. Returns a cleanup function that permanently stops the retry loop and aborts
// the in-flight fetch - call it on unmount/logout.
export function subscribeTenantStream(token, { onMessage, onOpen, onError }) {
  const controller = new AbortController();
  let stopped = false;
  let retryMs = INITIAL_RETRY_MS;
  let retryTimer = null;

  async function connectOnce() {
    const res = await fetch(`${BACKEND_URL}/v1/tenants/${TENANT_ID}/stream`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: controller.signal,
    });
    if (!res.ok || !res.body) {
      const err = new Error(`stream failed: ${res.status}`);
      err.status = res.status;
      throw err;
    }
    onOpen?.();
    retryMs = INITIAL_RETRY_MS; // a real successful connect resets backoff for the next drop

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      // SSE frames are separated by a blank line - process every complete frame currently
      // in the buffer, keeping any trailing partial frame for the next chunk.
      let sepIndex;
      while ((sepIndex = buffer.indexOf("\n\n")) !== -1) {
        const frame = buffer.slice(0, sepIndex);
        buffer = buffer.slice(sepIndex + 2);

        if (frame.startsWith(":")) continue; // comment-line keepalive, nothing to parse

        const dataLine = frame.split("\n").find((line) => line.startsWith("data:"));
        if (!dataLine) continue;
        const jsonText = dataLine.slice(5).trim();
        try {
          onMessage(JSON.parse(jsonText));
        } catch (e) {
          console.error("[sse] failed to parse frame:", e, jsonText);
        }
      }
    }
    // The server closed its end without an error - still a real disconnect (no more messages
    // will ever arrive on this response), so this has to be thrown and retried the same as any
    // other drop rather than falling off the end of connectOnce looking like success.
    throw new Error("tenant stream ended");
  }

  async function loop() {
    while (!stopped) {
      try {
        await connectOnce();
      } catch (e) {
        if (stopped || controller.signal.aborted) return; // real cleanup, not a drop
        onError?.(e);
        if (e?.status === 401) return; // caller logs out; retrying the same token can't help
      }
      if (stopped || controller.signal.aborted) return;
      await new Promise((resolve) => { retryTimer = setTimeout(resolve, retryMs); });
      if (stopped) return;
      retryMs = Math.min(retryMs * 2, MAX_RETRY_MS);
    }
  }

  loop();

  return () => {
    stopped = true;
    if (retryTimer) clearTimeout(retryTimer);
    controller.abort();
  };
}
