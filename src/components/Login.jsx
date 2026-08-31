import { useState } from "react";
import { Lock } from "lucide-react";
import { useLiveData } from "../context/LiveDataContext.jsx";
import { CasterlyLogo } from "./CasterlyLogo.jsx";
import { useTheme } from "../hooks/useTheme.js";

export default function Login() {
  const { login, authError } = useLiveData();
  const { family } = useTheme();
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const casterlyVariant = family === "dark" ? "dark" : "light";

  async function handleSubmit(e) {
    e.preventDefault();
    setSubmitting(true);
    await login(password);
    setSubmitting(false);
  }

  return (
    <div className="login-stage">
      <div className="app-fx" aria-hidden="true" />
      <form onSubmit={handleSubmit} className="card login-card">
        <div className="login-brand">
          <CasterlyLogo layout="stacked" variant={casterlyVariant} width={72} />
          <p className="login-kicker">Command Centre</p>
          <div className="brand-sub">Admin console</div>
        </div>

        <label style={{ fontSize: 12.5, color: "var(--text-dim)", display: "block", marginBottom: 6 }}>
          Admin password
        </label>
        <div className="search-box" style={{ width: "100%", maxWidth: "none", borderRadius: 10, marginBottom: 14 }}>
          <Lock size={15} />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Enter admin password"
            autoFocus
            style={{ background: "transparent", border: "none", outline: "none", color: "var(--text)", flex: 1, fontSize: 13 }}
          />
        </div>

        {authError && (
          <div className="badge red" style={{ display: "block", marginBottom: 14, padding: "8px 10px" }}>
            {authError}
          </div>
        )}

        <button type="submit" className="btn primary" style={{ width: "100%", justifyContent: "center" }} disabled={submitting || !password}>
          {submitting ? "Signing in…" : "Enter console"}
        </button>
      </form>
    </div>
  );
}
