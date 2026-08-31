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
export default function StatCard({ icon: Icon, tone = "blue", live, value, label, meta, to }) {
  const content = (
    <>
      <div className="stat-top">
        <div className="stat-icon">{Icon && <Icon size={16} />}</div>
        {live && <span className="stat-live"><span className="stat-live-dot" /> Live</span>}
      </div>
      <div className="stat-value">{value}</div>
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
