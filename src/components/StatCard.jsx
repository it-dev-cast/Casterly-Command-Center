import { Link } from "react-router-dom";

// "live" is honest - it means this value is fed by the real SSE stream, not a decorative claim
// about direction. Previously this took delta/deltaDir props and always rendered an up-arrow
// ("↗ live") regardless of whether the number actually went up - checked every real call site in
// the app, all 20 of them passed delta="live" and none ever passed a real measured direction, so
// there was no real trend behind that arrow. A pulsing dot says "this is live" without claiming
// a trend that was never actually measured.
//
// "to" is optional: when passed, the whole card is a real Link to a genuinely filtered page (e.g.
// /endpoints?health=critical) - only ever wired at call sites where that exact filter already
// exists and works, never invented just to make a tile clickable.
// Sensor self-diagnostic system: `reason` is a real, human-readable explanation for why `value`
// is a dash (tool not found, needs elevation, a placeholder sentinel, etc.) - shown only when
// passed, next to the value, as a small hoverable "i" using the plain-title tooltip convention
// the endpoint app's own AIInfo component already established (App.tsx) rather than inventing a
// second "hover to see disclosure text" mechanism for the same job.
function ReasonInfo({ text }) {
  return (
    <span
      className="stat-reason-info"
      tabIndex={0}
      aria-label={text}
      title={text}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 13,
        height: 13,
        borderRadius: 999,
        border: "1.5px solid var(--muted, #9aa4b2)",
        marginLeft: 5,
        cursor: "default",
        flexShrink: 0,
      }}
    >
      <span style={{ fontSize: 8, fontWeight: 700, color: "var(--muted, #9aa4b2)", lineHeight: 1 }}>i</span>
    </span>
  );
}

export default function StatCard({ icon: Icon, tone = "blue", live, value, label, meta, to, reason }) {
  const content = (
    <>
      <div className="stat-top">
        <div className="stat-icon">{Icon && <Icon size={16} />}</div>
        {live && <span className="stat-live"><span className="stat-live-dot" /> Live</span>}
      </div>
      <div className="stat-value" style={{ display: "flex", alignItems: "center" }}>
        {value}
        {reason && <ReasonInfo text={reason.message} />}
      </div>
      <div className="stat-label">{label}</div>
      {meta && <div className="stat-meta">{meta}</div>}
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`stat-card ${tone}`} style={{ cursor: "pointer" }}>
        {content}
      </Link>
    );
  }

  return <div className={`stat-card ${tone}`}>{content}</div>;
}
