import { createPersistedStore } from "./persistedStore.js";

// Real categories only, derived directly from grepping every insertEvent/fireEvent call site in
// the actual Go backend (handlers.go, incidents.go, offline_detection.go, alert_engine.go,
// remote_session.go) - not guessed. This is the complete real list of eventType strings this
// backend itself ever originates:
//   approval-requested-{action} / approval-approved-{action} / approval-rejected-{action}
//   device-revoked
//   hardware-tamper-detected / hardware-fingerprint-reset
//   duplicate-fingerprint-detected / duplicate-fingerprint-auto-revoked
//   warranty-review-voided / warranty-review-dismissed
//   remote-assist-requested
//   incident-created / incident-status-changed
//   alert-rule-triggered / alert-rule-cleared
//   device-offline / device-online
// A device's own local-agent can also send arbitrary free-text eventType values via the generic
// POST /devices/{id}/events (confirmed real examples seen live: backend-reachable,
// hwinfo-available/unavailable, lhm-available/unavailable, remediation-*) - these aren't a fixed
// enum this backend defines, so they fall into the honest "Other Device Activity" catch-all
// below rather than being individually enumerated (which would mean guessing at an unbounded set).
export const NOTIFICATION_CATEGORIES = [
  { key: "hardware", label: "Hardware & Tamper", match: (t) => t === "hardware-tamper-detected" || t === "hardware-fingerprint-reset" || t === "duplicate-fingerprint-detected" || t === "duplicate-fingerprint-auto-revoked" || t === "warranty-review-voided" || t === "warranty-review-dismissed" },
  { key: "liveness", label: "Device Liveness", match: (t) => t === "device-offline" || t === "device-online" || t === "device-revoked" },
  { key: "incidents", label: "Incidents", match: (t) => t === "incident-created" || t === "incident-status-changed" },
  { key: "approvals", label: "Approvals", match: (t) => t.startsWith("approval-requested-") || t.startsWith("approval-approved-") || t.startsWith("approval-rejected-") },
  { key: "alerts", label: "Alert Rules", match: (t) => t === "alert-rule-triggered" || t === "alert-rule-cleared" },
  { key: "remote", label: "Remote Assist", match: (t) => t === "remote-assist-requested" },
  { key: "other", label: "Other Device Activity", isCatchAll: true },
];

export function categorizeEventType(eventType) {
  const found = NOTIFICATION_CATEGORIES.find((c) => !c.isCatchAll && c.match(eventType));
  return found ? found.key : "other";
}

// Default: every category enabled - a key only ever appears in storage once explicitly disabled.
export const notificationPrefsStore = createPersistedStore("casterly_notification_prefs", {});

export function isCategoryEnabled(prefs, key) {
  return prefs[key] !== false;
}
