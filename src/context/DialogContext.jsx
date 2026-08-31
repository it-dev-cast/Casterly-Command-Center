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

  function settle(result) {
    if (resolveRef.current) resolveRef.current(result);
    resolveRef.current = null;
    setDialog(null);
  }

  return (
    <DialogContext.Provider value={{ confirmAsync, promptAsync }}>
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

  function handleCancel() {
    onSettle(isPrompt ? null : false);
  }
  function handleConfirm() {
    onSettle(isPrompt ? value : true);
  }

  return (
    <div
      style={{
        position: "fixed", inset: 0, background: "rgba(0,0,0,0.6)",
        display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000,
      }}
      onClick={(e) => { if (e.target === e.currentTarget) handleCancel(); }}
    >
      <div className="card" style={{ maxWidth: 420, width: "90%", padding: 20 }}>
        <p style={{ fontSize: 14, marginBottom: isPrompt ? 12 : 20, lineHeight: 1.5 }}>{dialog.message}</p>
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
        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <button className="btn" onClick={handleCancel}>Cancel</button>
          <button className="btn primary" onClick={handleConfirm} disabled={isPrompt && !value.trim()}>
            {isPrompt ? "Create" : dialog.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
