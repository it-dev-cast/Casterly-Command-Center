import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { AlertTriangle, ShieldAlert, Info, Monitor, CheckCircle2, XCircle, X } from "lucide-react";
import { useLiveData } from "../context/LiveDataContext.jsx";

const TOAST_META = {
  ticket: { icon: AlertTriangle, label: "Warning" },
  alert: { icon: ShieldAlert, label: "Critical" },
  notice: { icon: Info, label: "Notice" },
  health: { icon: Monitor, label: "Health" },
  success: { icon: CheckCircle2, label: "Done" },
  error: { icon: XCircle, label: "Failed" },
};

// Real toasts (context's own 6s auto-dismiss, or this component's close button) are removed from
// context state instantly - there's no "removing" state to animate against there. This local
// mirror keeps a just-removed toast mounted for one real exit-animation duration before actually
// dropping it, so closing/expiring plays a transition instead of an instant unstyled pop.
const EXIT_MS = 220;

export default function ToastStack() {
  const { toasts, dismissToast } = useLiveData();
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const timersRef = useRef({});

  useEffect(() => {
    const liveIds = new Set(toasts.map((t) => t.id));
    setItems((prev) => {
      const prevIds = new Set(prev.map((i) => i.id));
      const added = toasts.filter((t) => !prevIds.has(t.id)).map((t) => ({ ...t, exiting: false }));
      const kept = prev.map((i) => (liveIds.has(i.id) ? i : { ...i, exiting: true }));
      return [...kept, ...added];
    });
  }, [toasts]);

  useEffect(() => {
    items.forEach((item) => {
      if (item.exiting && !timersRef.current[item.id]) {
        timersRef.current[item.id] = setTimeout(() => {
          setItems((prev) => prev.filter((i) => i.id !== item.id));
          delete timersRef.current[item.id];
        }, EXIT_MS);
      }
    });
  }, [items]);

  useEffect(() => {
    const timers = timersRef.current;
    return () => { Object.values(timers).forEach(clearTimeout); };
  }, []);

  return (
    <div className="toast-stack">
      {items.map((t) => {
        const meta = TOAST_META[t.type] || { icon: Info, label: "Update" };
        const Icon = meta.icon;
        return (
          <div
            key={t.id}
            className={`toast ${t.type} ${t.exiting ? "exiting" : ""}${t.to ? " has-link" : ""}`}
            role={t.to ? "link" : undefined}
            onClick={() => {
              if (!t.to || t.exiting) return;
              dismissToast(t.id);
              navigate(t.to);
            }}
          >
            <button
              className="toast-close"
              onClick={(e) => { e.stopPropagation(); dismissToast(t.id); }}
              aria-label="Dismiss notification"
            >
              <X size={12} />
            </button>
            <div className="toast-title"><Icon size={13} /> {t.title}</div>
            {t.body && <div className="toast-body" title={t.body}>{t.body}</div>}
            {t.to && <div className="toast-go">{t.to.startsWith("/remote-assist") ? "Open Remote Assist →" : "Open this device →"}</div>}
          </div>
        );
      })}
    </div>
  );
}
