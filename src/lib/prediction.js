// Mirrors ai-service/app.py's evaluate_metric() exactly - the repo's one real AI capability (a
// closed-form least-squares regression over real device_metric_snapshots rows). The admin
// dashboard can't call ai-service's own GET /predict/:deviceId directly: that endpoint forwards
// the caller's bearer token straight through to the backend's DEVICE-scoped metric-snapshots
// route, which requires a per-device API key - something only the device itself ever holds
// (issued once at registration, never retrievable by the admin session afterward). Since this
// dashboard already fetches the identical real snapshot rows via the admin-scoped route
// (api.getDeviceMetricSnapshots), this reimplements the same documented algorithm client-side
// over that same real data - not a new model, not a fabricated number. Constants and thresholds
// are copied verbatim from ai-service/app.py.
const MIN_POINTS = 3;
const BATTERY_HEALTH_THRESHOLD = 80;
const SSD_WEAR_THRESHOLD = 90;
const RISK_LOW_DAYS = 180;
const RISK_MEDIUM_DAYS = 60;

// Mirrors ai-service/app.py's CONFIDENCE_MIN_POINTS/CONFIDENCE_R2_THRESHOLD exactly - same real
// fit-quality gate, same reasoning: R2 can be spuriously high with very few points, so both a
// minimum sample size AND a minimum R2 are required before a projection is labeled "high"
// confidence rather than "low".
const CONFIDENCE_MIN_POINTS = 5;
const CONFIDENCE_R2_THRESHOLD = 0.7;

function dayOffset(dateStr, firstDate) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return Math.round((d - firstDate) / 86400000);
}

function evaluateMetric(rows, key, threshold, direction) {
  const valid = rows.filter((r) => r[key] != null).map((r) => [String(r.recordedAt).slice(0, 10), r[key]]);
  if (valid.length < MIN_POINTS) {
    return { status: "insufficient-data", daysOfHistory: valid.length, minRequired: MIN_POINTS };
  }

  const firstDate = new Date(`${valid[0][0]}T00:00:00Z`);
  const xs = valid.map(([d]) => dayOffset(d, firstDate));
  const ys = valid.map(([, v]) => v);
  const currentValue = ys[ys.length - 1];

  const alreadyPast = direction === "increasing" ? currentValue >= threshold : currentValue <= threshold;
  if (alreadyPast) {
    return { status: "already-past-threshold", currentValue, daysOfHistory: valid.length };
  }

  // Plain closed-form least squares, degree 1 - the same computation numpy.polyfit(xs, ys, 1)
  // does in ai-service/app.py, just spelled out by hand instead of via a stats library.
  const n = xs.length;
  const sumX = xs.reduce((a, x) => a + x, 0);
  const sumY = ys.reduce((a, y) => a + y, 0);
  const sumXY = xs.reduce((a, x, i) => a + x * ys[i], 0);
  const sumXX = xs.reduce((a, x) => a + x * x, 0);
  const denom = n * sumXX - sumX * sumX;
  const slope = denom === 0 ? 0 : (n * sumXY - sumX * sumY) / denom;

  if (Math.abs(slope) < 1e-9) {
    return { status: "stable", currentValue, daysOfHistory: valid.length };
  }

  const days = (threshold - currentValue) / slope;
  if (!Number.isFinite(days) || days <= 0) {
    return { status: "stable", currentValue, daysOfHistory: valid.length };
  }

  const daysRemaining = Math.round(days);
  const risk = daysRemaining > RISK_LOW_DAYS ? "Low" : daysRemaining > RISK_MEDIUM_DAYS ? "Medium" : "High";

  // Real R2 over the same fit already computed above, mirroring ai-service/app.py exactly.
  // intercept isn't produced by the slope formula above, so it's derived here the same
  // standard-OLS way numpy.polyfit's second return value is defined.
  const intercept = (sumY - slope * sumX) / n;
  const meanY = sumY / n;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < n; i++) {
    const predicted = slope * xs[i] + intercept;
    ssRes += (ys[i] - predicted) ** 2;
    ssTot += (ys[i] - meanY) ** 2;
  }
  const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0;
  const confidence = r2 >= CONFIDENCE_R2_THRESHOLD && n >= CONFIDENCE_MIN_POINTS ? "high" : "low";

  return {
    status: "ok",
    currentValue,
    daysRemaining,
    risk,
    daysOfHistory: valid.length,
    confidence,
    r2: Math.round(r2 * 100) / 100,
  };
}

export function predictDeviceHealth(snapshots) {
  return {
    battery: evaluateMetric(snapshots, "batteryHealthPct", BATTERY_HEALTH_THRESHOLD, "decreasing"),
    ssd: evaluateMetric(snapshots, "ssdWearPct", SSD_WEAR_THRESHOLD, "increasing"),
  };
}
