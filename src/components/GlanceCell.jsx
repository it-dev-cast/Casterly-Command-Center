import { Link } from "react-router-dom";

export default function GlanceCell({ to, value, label, tone, meta, icon: Icon }) {
  const quiet = Number(value) === 0;
  return (
    <Link to={to} className={`glance-cell ${tone}${quiet ? " is-zero" : ""}`}>
      <div className="glance-top">
        {Icon && <Icon size={16} />}
        <span className="glance-label">{label}</span>
      </div>
      <div className="glance-value">{value}</div>
      {meta && <div className="glance-meta">{meta}</div>}
    </Link>
  );
}
