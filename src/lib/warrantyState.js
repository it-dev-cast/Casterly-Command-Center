import { isDeviceCurrentlyTampered } from "./deviceHealthScore.js";

// Real, honest v1 of PRD §6.4's Warranty State Machine. Computed client-side, the same
// architectural choice this app already makes for Device Health Score and healthFromLiveStatus -
// every input here is already reaching this app via the admin API (devices, the live events
// buffer, and the tenant's real entitlement from api.getEntitlement), so there's no reason to
// duplicate this derivation server-side for the dashboard the way backend/warranty.go has to for
// the device-authenticated agent path, which has no bulk event access of its own.
//
// All five of the PRD's states are reachable now, mirroring backend/warranty.go exactly:
//   - Active:      baseline intact AND the tenant's real entitlement is in good standing.
//   - UnderReview: an unresolved hardware-tamper-detected or device-identity-invalid event, no
//     warranty-review decision made yet either way.
//   - Voided:      device.warrantyVoidedAt is set - a real, human-confirmed decision (see
//     DeviceDetail.jsx's Confirm Voided action). Checked first, before anything else -
//     deliberately sticky, with no "un-void" path, so a later fingerprint reset never silently
//     un-voids a device.
//   - Expired:     the tenant's real entitlement has lapsed.

// device-identity-invalid has no reset lifecycle of its own yet (no "Reset Device Identity" flow
// exists - see backend/device_identity.go's own comment on this being a known, deliberate gap),
// unlike hardware-tamper-detected's real hardware-fingerprint-reset pairing that
// isDeviceCurrentlyTampered above already compares timestamps against. So this is deliberately
// simpler and more conservative: any device-identity-invalid event for this device anywhere in
// the live buffer counts, with no "since" boundary to compare against - a real, disclosed
// asymmetry between the two signals, not an oversight.
export function hasUnresolvedDeviceIdentityEvent(deviceId, events) {
  return events.some((e) => e.deviceId === deviceId && e.eventType === "device-identity-invalid");
}

const ENTITLEMENT_TO_WARRANTY = {
  Active: "Active",
  Expiring: "Active",
  Grace: "Active",
  Expired: "Expired",
  Suspended: "Expired",
};

// entitlementStatus is the tenant-wide real status from api.getEntitlement (Active/Expiring/
// Grace/Expired/Suspended) - null while it hasn't loaded yet, same "unknown, not fabricated"
// treatment as everything else here.
export function computeWarrantyState({ device, events, entitlementStatus }) {
  if (device?.warrantyVoidedAt) return "Voided";
  if (!device?.fingerprintLockedAt) return null;
  if (isDeviceCurrentlyTampered(device.id, events) || hasUnresolvedDeviceIdentityEvent(device.id, events)) {
    return "UnderReview";
  }
  if (!entitlementStatus) return null;
  return ENTITLEMENT_TO_WARRANTY[entitlementStatus] ?? null;
}

// Same tone convention as healthScoreTone/STATUS_TONE elsewhere in this app (green/amber/red/blue/
// gray - the real, complete set of .badge tone classes index.css defines; no "indigo" exists here
// the way the Tauri agent's own separate CSS does, so UnderReview reuses "blue" (this app's own
// neutral-informational tone) rather than introducing a new color token for one badge).
export function warrantyStateTone(state) {
  if (state === "Active") return "green";
  if (state === "UnderReview") return "blue";
  if (state === "Voided") return "red";
  if (state === "Expired") return "red";
  return "gray";
}
