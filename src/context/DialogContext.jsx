import { createContext, useCallback, useContext, useRef, useState } from "react";

const DialogContext = createContext(null);

export function DialogProvider({ children }) {
  const [dialog, setDialog] = useState(null);
  const resolveRef = useRef(null);

  const confirmAsync = useCallback((message, confirmLabel = "Confirm") => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ type: "confirm", message, confirmLabel });
    });
  }, []);

  const promptAsync = useCallback((message, defaultValue = "") => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ type: "prompt", message, defaultValue });
    });
  }, []);

  // For the genuinely dangerous cases plain confirmAsync's Yes/No isn't enough for (remote
  // command execution's own design note: a mistaken target device or a fat-fingered command is a
  // real risk a click-through Yes/No doesn't guard against) - retyping textToRetype verbatim is
  // required before the caller's Promise resolves true, forcing an actual re-read rather than a
  // reflexive click. Resolves true/false, same as confirmAsync, so call sites don't need to
  // special-case a third return shape.
  const confirmRetypeAsync = useCallback((message, textToRetype, confirmLabel = "Confirm") => {
    return new Promise((resolve) => {
      resolveRef.current = resolve;
      setDialog({ type: "confirm-retype", message, textToRetype, confirmLabel });
    });
  }, []);

  function settle(result) {
    if (resolveRef.current) resolveRef.current(result);
    resolveRef.current = null;
    setDialog(null);
  }

  return (
    <DialogContext.Provider value={{ confirmAsync, promptAsync, confirmRetypeAsync }}>
      {children}
      {dialog && <DialogModal dialog={dialog} onSettle={settle} />}
    </DialogContext.Provider>
  );
}

export function useDialog() {
  const ctx = useContext(DialogContext);
  if (!ctx) throw new Error("useDialog must be used within a DialogProvider");
  return ctx;
}

function DialogModal({ dialog, onSettle }) {
  const [value, setValue] = useState(dialog.defaultValue || "");
  const isPrompt = dialog.type === "prompt";
  const isRetype = dialog.type === "confirm-retype";

  function handleCancel() {
    onSettle(isPrompt ? null : false);
  }
  function handleConfirm() {
    onSettle(isPrompt ? value : true);
  }

  const retypeMismatch = isRetype && value !== dialog.textToRetype;

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div className="card" style={{ maxWidth: 480, width: "90%", padding: 20 }}>
        <p style={{ fontSize: 14, marginBottom: isPrompt || isRetype ? 12 : 20, lineHeight: 1.5 }}>{dialog.message}</p>
        {isPrompt && (
          <input
            autoFocus
            className="search-box"
            style={{ width: "100%", marginBottom: 20, border: "1px solid var(--border-soft)" }}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleConfirm();
              if (e.key === "Escape") handleCancel();
            }}
          />
        )}
        {isRetype && (
          <>
            <pre
              className="mono"
              style={{
                width: "100%", maxHeight: 160, overflow: "auto", whiteSpace: "pre-wrap", wordBreak: "break-word",
                background: "var(--bg-soft, #f5f5f5)", border: "1px solid var(--border-soft)", borderRadius: 6,
                padding: 10, fontSize: 12, marginBottom: 10,
              }}
            >
              {dialog.textToRetype}
            </pre>
            <label style={{ fontSize: 11.5, color: "var(--text-faint)", display: "block", marginBottom: 4 }}>
              Retype the exact text above to confirm:
            </label>
            <input
              autoFocus
              className="search-box"
              style={{ width: "100%", marginBottom: 20, border: "1px solid var(--border-soft)" }}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !retypeMismatch) handleConfirm();
                if (e.key === "Escape") handleCancel();
              }}
            />
          </>
        )}
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={handleCancel}>Cancel</button>
          <button className="btn primary" onClick={handleConfirm} disabled={(isPrompt && !value.trim()) || retypeMismatch}>
            {isPrompt ? "Create" : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
