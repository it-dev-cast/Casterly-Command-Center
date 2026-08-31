import { useState } from "react";
import { X, Plus } from "lucide-react";
import { useLiveData } from "../context/LiveDataContext.jsx";

export default function TagEditor({ deviceId, tags }) {
  const { setDeviceTags, pushToast } = useLiveData();
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  async function commit(nextTags) {
    setBusy(true);
    try {
      await setDeviceTags(deviceId, nextTags);
    } catch (e) {
      pushToast("error", "Tag update failed", e.message);
    } finally {
      setBusy(false);
    }
  }

  function handleAdd() {
    const tag = input.trim();
    if (!tag || tags.includes(tag)) {
      setInput("");
      return;
    }
    setInput("");
    commit([...tags, tag]);
  }

  function handleRemove(tag) {
    commit(tags.filter((t) => t !== tag));
  }

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6 }}>
      {tags.map((t) => (
        <span
          key={t}
          className="badge"
          style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "var(--bg-panel-2)", border: "1px solid var(--border-soft)" }}
        >
          {t}
          <button
            onClick={() => handleRemove(t)}
            disabled={busy}
            style={{ background: "none", border: "none", cursor: "pointer", padding: 0, display: "flex", color: "var(--text-faint)" }}
            title="Remove tag"
          >
            <X size={11} />
          </button>
        </span>
      ))}
      <input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") handleAdd(); }}
        placeholder="Add tag…"
        disabled={busy}
        style={{ width: 90, fontSize: 12, padding: "3px 8px", borderRadius: 6, border: "1px solid var(--border-soft)", background: "transparent", color: "inherit" }}
      />
      <button onClick={handleAdd} disabled={busy || !input.trim()} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--accent)", display: "flex" }}>
        <Plus size={14} />
      </button>
    </div>
  );
}
