import { useEffect, useState } from "react";
import { api } from "../lib/api.js";

// The one real backend-liveness check (GET /v1/health, DB-backed - see backend/handlers.go's
// handleHealth) - shared between Infrastructure.jsx's Platform Health card and Settings.jsx's
// Connection tab, rather than two independently-maintained copies of the same fetch+latency logic.
export function useApiHealth() {
  const [apiHealth, setApiHealth] = useState(null);
  const [checking, setChecking] = useState(true);

  function checkHealth() {
    setChecking(true);
    const start = performance.now();
    api.getHealth()
      .then((res) => setApiHealth({ ok: res.status === "ok", latencyMs: Math.round(performance.now() - start) }))
      .catch(() => setApiHealth({ ok: false, latencyMs: null }))
      .finally(() => setChecking(false));
  }

  useEffect(() => { checkHealth(); }, []);

  return { apiHealth, checking, checkHealth };
}
