import { Building2 } from "lucide-react";

export default function DataCenters() {
  return (
    <div>
      <h1 className="page-title">Data Centers</h1>
      <p className="page-sub">No real data-center monitoring integration exists yet</p>

      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 20px", textAlign: "center" }}>
          <Building2 size={32} color="var(--text-faint)" style={{ marginBottom: 14 }} />
          <h3 className="section-title" style={{ marginBottom: 8 }}>No data centers configured</h3>
          <p className="section-sub" style={{ maxWidth: 440 }}>
            This system monitors endpoint laptops via the local agent — it has no facility-level
            sensors, power/cooling telemetry, or data-center inventory. This page will show real
            facilities once that kind of monitoring is actually integrated. No placeholder numbers
            are shown in the meantime.
          </p>
        </div>
      </div>
    </div>
  );
}
