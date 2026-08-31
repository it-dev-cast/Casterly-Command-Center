// Custom SSE client using fetch() + a streamed response body, NOT the browser's native
// EventSource - EventSource has no way to set custom request headers, so it can't send the
// `Authorization: Bearer <adminToken>` this backend's adminAuthMiddleware requires (see
// handleTenantStream's own comment on why the endpoint is header-authenticated like every
// other admin call rather than accepting a token query param, which would leak the JWT into
// server access logs / browser history for no real benefit).
import { BACKEND_URL, TENANT_ID } from "./api.js";

// subscribeTenantStream opens GET /v1/tenants/{id}/stream and calls onMessage(parsedJSON) for
// every real "data: ...\n\n" frame the backend's liveHub publishes (see live.go). Returns a
// cleanup function that aborts the underlying fetch - call it on unmount/logout.
export function subscribeTenantStream(token, { onMessage, onOpen, onError }) {
  const controller = new AbortController();

  (async () => {
    try {
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
    } catch (e) {
      if (controller.signal.aborted) return; // expected on cleanup, not a real error
      onError?.(e);
    }
  })();

  return () => controller.abort();
}
