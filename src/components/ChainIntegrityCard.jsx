import { useState } from "react";
import { ShieldCheck, ShieldAlert, Loader2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useLiveData } from "../context/LiveDataContext.jsx";

// Real, on-demand tenant-wide hash-chain verification (GET /v1/tenants/{id}/events/verify-chain) -
// extracted out of Settings.jsx so Device 360's Events tab can offer the exact same real check
// instead of a second, independently-built copy. Verification is always tenant-wide (the backend
// has no per-device chain), so callers that render this inside a device-scoped context should say
// so alongside it, same as this component's own subtitle already does.
export default function ChainIntegrityCard() {
  const { token } = useLiveData();
  const [chainResult, setChainResult] = useState(null);
  const [chainError, setChainError] = useState(null);
  const [checking, setChecking] = useState(false);

  async function handleVerifyChain() {
    setChecking(true);
    setChainError(null);
    try {
      const result = await api.verifyEventChain(token);
      setChainResult(result);
    } catch (e) {
      setChainError(e.message);
    } finally {
      setChecking(false);
    }
  }

  return (
    <div className="card">
      <div className="section-head">
        <div>
          <h3 className="section-title">Event Chain Integrity</h3>
          <p className="section-sub">Every event is hash-chained as it's written — this checks the real chain on demand, not a scheduled/cached score</p>
        </div>
        <button className="btn primary" onClick={handleVerifyChain} disabled={checking}>
          {checking ? <><Loader2 size={14} className="spin" /> Checking…</> : "Verify Event Chain"}
        </button>
      </div>

      {chainError && <div className="empty-note" style={{ color: "var(--red)" }}>Unable to verify event chain: {chainError}</div>}

      {chainResult && (
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, marginTop: 8 }}>
          {chainResult.intact
            ? <ShieldCheck size={22} color="var(--green)" style={{ flexShrink: 0, marginTop: 2 }} />
            : <ShieldAlert size={22} color="var(--red)" style={{ flexShrink: 0, marginTop: 2 }} />}
          <div>
            <div style={{ fontWeight: 700, color: chainResult.intact ? "var(--green)" : "var(--red)" }}>
              {chainResult.intact ? "Chain intact" : "Chain broken"}
            </div>
            <div className="section-sub" style={{ marginTop: 4 }}>
              {chainResult.chainedEventsChecked} chained event{chainResult.chainedEventsChecked !== 1 ? "s" : ""} checked
              {chainResult.startsAtGenesis ? ", starts at genesis" : ""}
              {chainResult.untrackedHistoricalEvents ? ` · ${chainResult.untrackedHistoricalEvents} untracked historical event${chainResult.untrackedHistoricalEvents !== 1 ? "s" : ""} predate chaining` : ""}
              {!chainResult.intact && chainResult.reason ? ` · ${chainResult.reason}` : ""}
              {!chainResult.intact && chainResult.brokenAtEventId ? ` · broken at event ${chainResult.brokenAtEventId}` : ""}
            </div>
          </div>
        </div>
      )}

      {!chainResult && !chainError && !checking && (
        <div className="empty-note">Not verified yet this session.</div>
      )}
    </div>
  );
}
