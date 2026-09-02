import { getLiveDetail } from "./liveDetail.js";

// Composite Device Health Score (0-100), per the PRD's weighting model. Computed client-side,
// the same architectural choice this codebase already makes for healthFromLiveStatus (
// LiveDataContext.jsx) and predictDeviceHealth (prediction.js) - real math over real data
// that's already reaching this app via the admin API, not a new backend call or stored value.
// Every input below is a real, already-collected signal (see the investigation this was built
// from); nothing here is fabricated, and a dimension whose real signal is null for a given
// device is honestly reported as unavailable and excluded from that device's own score, rather
// than defaulted to a guessed number.
//
// One PRD dimension is still deliberately NOT here:
//   - Thermal Performance (10%): cpuTempC/gpuTempC are real when LibreHardwareMonitor happens to
//     be installed and running on that specific machine, but that's a per-machine opt-in
//     dependency, not a guaranteed first-party collector - coverage would be fleet-inconsistent
//     in a way the other five dimensions aren't. Surfaced as its own separate, unscored info
//     line (getThermalInfo below) instead of silently missing from - or unevenly weighted into -
//     a "composite" score.
//
// OS & Software Health (15%) folded in now that windowsUpdatePendingCount/windowsUpdateCheckedAt
// are confirmed real and flowing (extractLiveStatusFields in telemetry-server.mjs, shown on
// Device 360) - see scoreOsSoftwareHealth below for the real formula.
//
// Weights sum to 100 across the five included dimensions (renormalized from the PRD's full
// six-dimension model: 30/20/15/10/15 -> 33.3/22.2/16.7/11.1/16.7, keeping Hardware Integrity :
// Storage Wear : Battery : Security : OS & Software Health in the same 30:20:15:10:15 ratio the
// PRD specifies).
export const HEALTH_SCORE_WEIGHTS = {
  hardwareIntegrity: 33.3,
  storageWear: 22.2,
  battery: 16.7,
  security: 11.1,
  osSoftwareHealth: 16.7,
};

function clamp(n, min, max) {
  return Math.max(min, Math.min(max, n));
}

// A locked baseline that currently mismatches means every hardware-check since the mismatch
// first appeared (every 5 minutes - see backend/handlers.go's handleHardwareCheck, which never
// overwrites the baseline on its own) has kept re-firing hardware-tamper-detected - so unlike
// device liveness, "is this still unresolved right now" never depends on one old event surviving
// in the live buffer long enough to still be visible; a genuinely still-tampered device always
// has a very recent one. Only hardware-fingerprint-reset (the real, explicit "Reset FP" admin
// action - resetDeviceFingerprint) ever clears this. Real, confirmed caveat, same one already
// documented in deviceLiveness.js: `events` is this app's live buffer, not full history, so an
// old reset whose own evidence has since fallen out of that buffer, on a fleet busy enough to
// evict it, could misread as still-tampered - rare (resets are one-time admin actions, and a
// resolved device stops generating the very events that would crowd the buffer), not fixed here.
export function isDeviceCurrentlyTampered(deviceId, events) {
  let latestTamper = null;
  let latestReset = null;
  for (const e of events) {
    if (e.deviceId !== deviceId) continue;
    if (e.eventType === "hardware-tamper-detected") {
      if (!latestTamper || new Date(e.createdAt) > new Date(latestTamper.createdAt)) latestTamper = e;
    } else if (e.eventType === "hardware-fingerprint-reset") {
      if (!latestReset || new Date(e.createdAt) > new Date(latestReset.createdAt)) latestReset = e;
    }
  }
  if (!latestTamper) return false;
  if (!latestReset) return true;
  return new Date(latestTamper.createdAt) > new Date(latestReset.createdAt);
}

// A fixed penalty, not a smooth gradient - hardware integrity from this data is fundamentally a
// state (matches baseline / doesn't), not a percentage, and pretending otherwise would invent
// precision this signal doesn't have. 40, not 0: a real, still-serviceable machine flagged for a
// field-level mismatch (e.g. a legitimate RAM/drive swap not yet acknowledged via Reset FP) isn't
// as bad as literally zero real hardware integrity - but it's a real, critical-severity flag
// (see handleHardwareCheck's own "critical" severity) that should visibly drag the composite down.
const TAMPERED_SCORE = 40;

export function scoreHardwareIntegrity(device, events) {
  if (!device?.fingerprintLockedAt) return { score: null, available: false };
  return isDeviceCurrentlyTampered(device.id, events)
    ? { score: TAMPERED_SCORE, available: true }
    : { score: 100, available: true };
}

// Battery/storage health percentages are already real 0-100 "higher is better"/"higher is worse"
// facts (see batteryHealth.js's own real thresholds, reused for tone elsewhere in this app) -
// no transform needed beyond clamping and, for wear, inverting to a health framing.
export function scoreBattery(batteryHealthPct) {
  if (batteryHealthPct == null) return { score: null, available: false };
  return { score: clamp(batteryHealthPct, 0, 100), available: true };
}

export function scoreStorageWear(storageWearPct) {
  if (storageWearPct == null) return { score: null, available: false };
  return { score: clamp(100 - storageWearPct, 0, 100), available: true };
}

export function scoreSecurity(securityHealthPct) {
  if (securityHealthPct == null) return { score: null, available: false };
  return { score: clamp(securityHealthPct, 0, 100), available: true };
}

// Real, linear decay per pending update, not a smooth percentage - a Windows Update pending
// count is a small integer, not already a 0-100 fact the way battery/storage health are, so this
// picks real, round, defensible numbers rather than inventing false precision: 10 points off per
// pending update, floored at 20 (not 0) once 8+ are pending - a machine behind on updates is a
// real, informational signal, not as severe as active hardware tampering (scoreHardwareIntegrity's
// own floor is lower, 40, for exactly that reason - these floors are deliberately different).
// Gated on windowsUpdateCheckedAt, not just pendingCount, since a device that has never
// completed its first hourly check (see runWindowsUpdateCheck) has a real "unknown," not a real
// zero - the same distinction Device 360's own Kv row for this field already makes.
const WINDOWS_UPDATE_PENALTY_PER_PENDING = 10;
const WINDOWS_UPDATE_SCORE_FLOOR = 20;

export function scoreOsSoftwareHealth(windowsUpdatePendingCount, windowsUpdateCheckedAt) {
  if (windowsUpdateCheckedAt == null || windowsUpdatePendingCount == null) return { score: null, available: false };
  return {
    score: clamp(100 - windowsUpdatePendingCount * WINDOWS_UPDATE_PENALTY_PER_PENDING, WINDOWS_UPDATE_SCORE_FLOOR, 100),
    available: true,
  };
}

// computeDeviceHealthScore renormalizes weights per device over whichever of the five dimensions
// are actually available for it - a desktop with no battery isn't penalized for a dimension that
// genuinely doesn't apply to it, the same "not applicable, not zero" principle every dimension
// formula above already follows individually. overall is null only when ALL FIVE dimensions are
// unavailable for this device - an honest "not enough real data yet" rather than a fabricated
// default score.
export function computeDeviceHealthScore({
  device, events, batteryHealthPct, storageWearPct, securityHealthPct,
  windowsUpdatePendingCount, windowsUpdateCheckedAt,
}) {
  const dimensions = {
    hardwareIntegrity: scoreHardwareIntegrity(device, events),
    storageWear: scoreStorageWear(storageWearPct),
    battery: scoreBattery(batteryHealthPct),
    security: scoreSecurity(securityHealthPct),
    osSoftwareHealth: scoreOsSoftwareHealth(windowsUpdatePendingCount, windowsUpdateCheckedAt),
  };

  let weightedSum = 0;
  let weightTotal = 0;
  for (const key of Object.keys(HEALTH_SCORE_WEIGHTS)) {
    const dim = dimensions[key];
    if (dim.available) {
      weightedSum += dim.score * HEALTH_SCORE_WEIGHTS[key];
      weightTotal += HEALTH_SCORE_WEIGHTS[key];
    }
  }

  return {
    overall: weightTotal > 0 ? Math.round(weightedSum / weightTotal) : null,
    dimensions,
  };
}

// Real thresholds for this specific 0-100 composite scale, not reused from CPU/RAM/Disk or
// battery-health tone elsewhere in this app (those are each about a different, differently-shaped
// real percentage) - a new scale needs its own real bands, documented here as what they are.
export function healthScoreTone(score) {
  if (score == null) return "gray";
  if (score >= 80) return "green";
  if (score >= 50) return "amber";
  return "red";
}

// Thermal is deliberately NOT part of computeDeviceHealthScore above (see this file's own
// top-of-file comment on why) - this is the separate, unscored real signal for an info-only
// display. available reflects whether LibreHardwareMonitor (or HWiNFO) happened to be reachable
// on this specific device this cycle, not a fleet-wide fact.
export function getThermalInfo(liveStatus) {
  const detail = getLiveDetail(liveStatus);
  const cpuTempC = detail.cpuTempC ?? null;
  const gpuTempC = detail.gpuTempC ?? null;
  return { available: cpuTempC != null || gpuTempC != null, cpuTempC, gpuTempC };
}
