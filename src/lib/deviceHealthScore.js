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
// OS & Software Health (15%) folded in now that windowsUpdatePendingCount/windowsUpdateCheckedAt
// are confirmed real and flowing (extractLiveStatusFields in telemetry-server.mjs, shown on
// Device 360) - see scoreOsSoftwareHealth below for the real formula.
//
// Thermal Performance (10%) folded in now too, using the same cpuTempC/gpuTempC LibreHardwareMonitor
// signal Device 360's own raw temp tiles already display - see scoreThermalPerformance below for
// the real formula. Per-machine coverage is still real and fleet-inconsistent (LibreHardwareMonitor
// is a per-machine opt-in dependency, not a guaranteed first-party collector), but that's exactly
// what per-device renormalization below already exists to handle - the same "not applicable, not
// zero" treatment every other optional dimension here already gets, not a reason to keep it out.
//
// All six of the PRD's real dimensions are included now, at the PRD's own original ratio -
// Hardware Integrity 30 : Storage Wear 20 : Battery 15 : OS & Software Health 15 : Thermal
// Performance 10 : Security 10 - which already sums to 100, so no renormalization is needed here
// at the constant level (unlike the earlier 5-dimension version, which had to renormalize Thermal's
// share away). Per-device renormalization in computeDeviceHealthScore below is unchanged - it
// still activates whenever any dimension (thermal included) is unavailable for a specific device.
//
// Three dimensions got richer real inputs, not new weights - BIOS firmware currency and Defender
// signature currency folded into OS & Software Health (worst-of-three with Windows Update, same
// reasoning scoreThermalPerformance already established for "don't dilute one real problem by
// averaging it against unrelated healthy signals"); MDM/domain-join and AV-product-registration
// folded into Security (now five equally-weighted real booleans - TPM/SecureBoot/BitLocker plus
// isDeviceManaged/isAvActive - instead of clamping the pre-averaged securityHealthPct); NVMe
// media_errors/critical_warning folded into Storage Wear (worst-of-three with wear%). Battery
// cycle count deliberately stays out - it's a wear indicator already reflected in
// batteryHealthPct itself, and there's no honest universal "bad" cycle-count threshold without
// knowing that specific battery's rated cycle life, which this app doesn't have.
export const HEALTH_SCORE_WEIGHTS = {
  hardwareIntegrity: 30,
  storageWear: 20,
  battery: 15,
  osSoftwareHealth: 15,
  thermal: 10,
  security: 10,
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

// storageCriticalWarning/storageMediaErrors are treated as fixed-penalty states, not smooth
// gradients, same reasoning as TAMPERED_SCORE below - both are NVMe facts about something that
// has already genuinely happened (a real controller health flag; a real, non-reversible
// data-integrity error count), not a continuously-degrading measurement the way wear% is.
// storageMediaErrors' floor deliberately matches TAMPERED_SCORE's value (40) as a SEPARATE
// constant, not a shared reference - both represent the same severity class (a real, already-
// happened, non-reversible integrity event), but tuning one shouldn't silently retune the other.
// Worst-of-three (not an average) for the same reason scoreThermalPerformance already picks the
// worse of cpuTempC/gpuTempC: a real problem on any one of these three shouldn't be diluted by
// averaging against the other two reading fine.
const STORAGE_CRITICAL_WARNING_SCORE_FLOOR = 30;
const STORAGE_MEDIA_ERRORS_SCORE_FLOOR = 40;

export function scoreStorageWear(storageWearPct, storageCriticalWarning, storageMediaErrors) {
  const scores = [];
  if (storageWearPct != null) scores.push(clamp(100 - storageWearPct, 0, 100));
  if (storageCriticalWarning != null) scores.push(storageCriticalWarning === 0 ? 100 : STORAGE_CRITICAL_WARNING_SCORE_FLOOR);
  if (storageMediaErrors != null) scores.push(storageMediaErrors > 0 ? STORAGE_MEDIA_ERRORS_SCORE_FLOOR : 100);
  if (scores.length === 0) return { score: null, available: false };
  return { score: Math.min(...scores), available: true };
}

// managed = true if this device is under ANY recognized enterprise oversight - MDM enrollment,
// OR a traditional domain/Azure AD/legacy-enterprise join without MDM (common on older AD/GPO-
// managed fleets). Narrower coverage (MDM-only) would unfairly read a domain-joined-but-not-MDM-
// enrolled device as "unmanaged." Workplace Join (Azure AD Registered/BYOD) is deliberately NOT
// included - that's a personal device with a work account added, not enterprise-owned/managed the
// way the other four are. null (not false) when none of the four have ever been checked - a
// device that hasn't completed its first dsregcmd check reads as unknown, not confidently
// "unmanaged."
export function isDeviceManaged({ mdmEnrolled, domainJoined, azureAdJoined, enterpriseJoined }) {
  const checks = [mdmEnrolled, domainJoined, azureAdJoined, enterpriseJoined];
  if (checks.every((v) => v == null)) return null;
  return checks.some(Boolean);
}

// avActive = at least one AV product (Defender or third-party) is registered with Windows
// Security Center - deliberately NOT combined with defenderRealTimeProtectionEnabled. A machine
// running third-party AV normally has Defender's own real-time protection disabled by design
// (avoiding conflicts) - SecurityCenter2's own productState field is the only way to check a
// third-party product's real-time-protection state, and it has no Microsoft-published bit layout
// (see extractLiveStatusFields' own comment on why it's never decoded). ANDing the two would
// unfairly penalize every third-party-AV machine for a fact this app can't reliably check for
// that product.
export function isAvActive(avProductNames) {
  if (!Array.isArray(avProductNames)) return null;
  return avProductNames.length > 0;
}

// Five equally-weighted real checks (20% each), same "count of real signals present" shape
// securityFromTelemetry (telemetry-server.mjs) already uses for the raw TPM/SecureBoot/BitLocker
// average - just wider. Deliberately reads the three raw booleans directly (all three are sent
// independently in `detail`, not just the pre-averaged securityHealthPct) rather than clamping
// that existing percentage, so this dimension isn't locked to always weighting TPM/SecureBoot/
// BitLocker as a single pre-baked 1/3 each - each of the five checks here is its own real 1/5.
// securityHealthPct itself is untouched by this change - it's still computed and shown standalone
// (the raw "Security" StatCard) exactly as before.
export function scoreSecurity(tpmActive, secureBootEnabled, bitlockerOn, managed, avActive) {
  const checks = [tpmActive, secureBootEnabled, bitlockerOn, managed, avActive].filter((v) => v != null);
  if (checks.length === 0) return { score: null, available: false };
  return { score: Math.round((checks.filter(Boolean).length / checks.length) * 100), available: true };
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

function scoreWindowsUpdate(windowsUpdatePendingCount, windowsUpdateCheckedAt) {
  if (windowsUpdateCheckedAt == null || windowsUpdatePendingCount == null) return null;
  return clamp(100 - windowsUpdatePendingCount * WINDOWS_UPDATE_PENALTY_PER_PENDING, WINDOWS_UPDATE_SCORE_FLOOR, 100);
}

// A fixed penalty, not a gradient - unlike Windows Update, biosFirmwareUpdateAvailable is a
// boolean (available or not), not a count to decay against. Deliberately gentler than a single
// pending Windows Update (-10, floor 20): BIOS updates are far rarer and usually far less urgent
// (often optional/stability-only) than routine software patches, so one being available shouldn't
// hit this dimension as hard.
const BIOS_UPDATE_AVAILABLE_SCORE = 85;

function scoreBiosUpdate(biosFirmwareUpdateAvailable, biosFirmwareCheckedAt) {
  if (biosFirmwareCheckedAt == null || typeof biosFirmwareUpdateAvailable !== "boolean") return null;
  return biosFirmwareUpdateAvailable ? BIOS_UPDATE_AVAILABLE_SCORE : 100;
}

// Real, linear decay by signature age - same good-max/critical-min/floor shape as
// scoreThermalPerformance below, reused rather than a new curve invented for this. 2 days covers
// a machine that was briefly off/asleep without false-flagging (Defender updates roughly daily
// when reachable); 14 days (two weeks stale) is a real problem - something's likely broken, not
// just quiet. Floor of 20 matches Windows Update's own floor, same "real but non-critical"
// severity tier reused, not a new number invented for this specific penalty.
const DEFENDER_SIGNATURE_GOOD_MAX_DAYS = 2;
const DEFENDER_SIGNATURE_CRITICAL_MIN_DAYS = 14;
const DEFENDER_SIGNATURE_SCORE_FLOOR = 20;

function scoreDefenderSignatureCurrency(defenderSignatureLastUpdated) {
  if (defenderSignatureLastUpdated == null) return null;
  const ageDays = (Date.now() - new Date(defenderSignatureLastUpdated).getTime()) / (1000 * 60 * 60 * 24);
  if (ageDays <= DEFENDER_SIGNATURE_GOOD_MAX_DAYS) return 100;
  if (ageDays >= DEFENDER_SIGNATURE_CRITICAL_MIN_DAYS) return DEFENDER_SIGNATURE_SCORE_FLOOR;
  const fractionToFloor = (ageDays - DEFENDER_SIGNATURE_GOOD_MAX_DAYS) / (DEFENDER_SIGNATURE_CRITICAL_MIN_DAYS - DEFENDER_SIGNATURE_GOOD_MAX_DAYS);
  return Math.round(100 - fractionToFloor * (100 - DEFENDER_SIGNATURE_SCORE_FLOOR));
}

// Worst-of-three (not an average), same reasoning as scoreThermalPerformance/scoreStorageWear -
// Windows Update currency, BIOS currency, and Defender signature currency are three independent
// "is this specific piece of software/firmware current" facts; a real problem in any one of them
// shouldn't be diluted by averaging against the other two reading fine. Each sub-score is gated
// independently on its own real signal, so a device missing one or two of the three checks still
// scores on whichever it has.
export function scoreOsSoftwareHealth(windowsUpdatePendingCount, windowsUpdateCheckedAt, biosFirmwareUpdateAvailable, biosFirmwareCheckedAt, defenderSignatureLastUpdated) {
  const scores = [
    scoreWindowsUpdate(windowsUpdatePendingCount, windowsUpdateCheckedAt),
    scoreBiosUpdate(biosFirmwareUpdateAvailable, biosFirmwareCheckedAt),
    scoreDefenderSignatureCurrency(defenderSignatureLastUpdated),
  ].filter((s) => s != null);
  if (scores.length === 0) return { score: null, available: false };
  return { score: Math.min(...scores), available: true };
}

// Real, linear decay from a real "starts being bad" reference point - 85C is the same threshold
// DeviceDetail.jsx's own deviceAlerts() and CPU Temp StatCard already flag as a real problem
// elsewhere in this codebase, not a new number invented for this formula. 100 at <=70C (a normal,
// unremarkable operating temperature for either a CPU or GPU under real load), floor of 20 at
// >=95C (thermal-throttling territory, not yet 0 - a device this hot is still real and running,
// not the worst possible state this scale can express). The existing 85C reference point falls at
// score ~52 under this line (100 - (85-70)/(95-70)*80 = 52) - just inside amber, consistent with
// 85C already being treated as "starts being bad" elsewhere, not a coincidence worth hard-coding
// as a second breakpoint.
const THERMAL_GOOD_MAX_C = 70;
const THERMAL_CRITICAL_MIN_C = 95;
const THERMAL_SCORE_FLOOR = 20;

// Worse of cpuTempC/gpuTempC, not an average - a single real overheating component is a real
// thermal problem for the device even while the other one reads fine, and averaging it against a
// cool reading would dilute a signal this formula exists specifically to catch. Either alone is
// used as-is when only one sensor is real for this device (most laptops have no discrete GPU
// sensor at all) - available is false only when neither reading exists.
export function scoreThermalPerformance(cpuTempC, gpuTempC) {
  const temps = [cpuTempC, gpuTempC].filter((t) => t != null);
  if (temps.length === 0) return { score: null, available: false };
  const worst = Math.max(...temps);
  if (worst <= THERMAL_GOOD_MAX_C) return { score: 100, available: true };
  if (worst >= THERMAL_CRITICAL_MIN_C) return { score: THERMAL_SCORE_FLOOR, available: true };
  const fractionToFloor = (worst - THERMAL_GOOD_MAX_C) / (THERMAL_CRITICAL_MIN_C - THERMAL_GOOD_MAX_C);
  const score = Math.round(100 - fractionToFloor * (100 - THERMAL_SCORE_FLOOR));
  return { score: clamp(score, THERMAL_SCORE_FLOOR, 100), available: true };
}

// computeDeviceHealthScore renormalizes weights per device over whichever of the six dimensions
// are actually available for it - a desktop with no battery isn't penalized for a dimension that
// genuinely doesn't apply to it, the same "not applicable, not zero" principle every dimension
// formula above already follows individually. overall is null only when ALL SIX dimensions are
// unavailable for this device - an honest "not enough real data yet" rather than a fabricated
// default score.
export function computeDeviceHealthScore({
  device, events, batteryHealthPct, storageWearPct,
  windowsUpdatePendingCount, windowsUpdateCheckedAt, cpuTempC, gpuTempC,
  storageCriticalWarning, storageMediaErrors,
  tpmActive, secureBootEnabled, bitlockerOn,
  mdmEnrolled, domainJoined, azureAdJoined, enterpriseJoined, avProductNames,
  biosFirmwareUpdateAvailable, biosFirmwareCheckedAt, defenderSignatureLastUpdated,
}) {
  const dimensions = {
    hardwareIntegrity: scoreHardwareIntegrity(device, events),
    storageWear: scoreStorageWear(storageWearPct, storageCriticalWarning, storageMediaErrors),
    battery: scoreBattery(batteryHealthPct),
    security: scoreSecurity(
      tpmActive, secureBootEnabled, bitlockerOn,
      isDeviceManaged({ mdmEnrolled, domainJoined, azureAdJoined, enterpriseJoined }),
      isAvActive(avProductNames),
    ),
    osSoftwareHealth: scoreOsSoftwareHealth(windowsUpdatePendingCount, windowsUpdateCheckedAt, biosFirmwareUpdateAvailable, biosFirmwareCheckedAt, defenderSignatureLastUpdated),
    thermal: scoreThermalPerformance(cpuTempC, gpuTempC),
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

// Thermal now feeds computeDeviceHealthScore above via scoreThermalPerformance - this stays as
// the separate raw-value helper for Device 360's own supplementary temperature line, the same
// way batteryHealthPct/securityHealthPct also still get their own raw StatCard display alongside
// feeding the composite. available reflects whether LibreHardwareMonitor (or HWiNFO) happened to
// be reachable on this specific device this cycle, not a fleet-wide fact.
export function getThermalInfo(liveStatus) {
  const detail = getLiveDetail(liveStatus);
  const cpuTempC = detail.cpuTempC ?? null;
  const gpuTempC = detail.gpuTempC ?? null;
  return { available: cpuTempC != null || gpuTempC != null, cpuTempC, gpuTempC };
}
