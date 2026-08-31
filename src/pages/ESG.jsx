import { Leaf, Info } from "lucide-react";

export default function ESG() {
  return (
    <div>
      <h1 className="page-title">ESG & Sustainability</h1>
      <p className="page-sub">No real energy, carbon, or compliance data source exists yet</p>

      <div className="card">
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "48px 20px", textAlign: "center" }}>
          <Leaf size={32} color="var(--text-faint)" style={{ marginBottom: 14 }} />
          <h3 className="section-title" style={{ marginBottom: 8, display: "inline-flex", alignItems: "center", gap: 6 }}>
            No sustainability data yet
            <Info size={13} color="var(--text-faint)" style={{ cursor: "help" }} title="Real energy consumption, carbon emissions, and compliance tracking would need power monitoring and reporting integrations that don't exist in this system yet." />
          </h3>
          <p className="section-sub" style={{ maxWidth: 440 }}>
            No fabricated numbers — real data will appear once a source exists.
          </p>
        </div>
      </div>
    </div>
  );
}
