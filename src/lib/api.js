// Talks to the REAL Casterly command-center Go backend (backend/) - not a mock. Base URL and
// tenant ID match backend/README.md's own curl examples and schema.sql's seeded tenant-1.
export const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || "http://localhost:8443";
export const TENANT_ID = import.meta.env.VITE_TENANT_ID || "tenant-1";

async function request(path, { method = "GET", token, body } = {}) {
  const headers = {};
  if (body) headers["Content-Type"] = "application/json";
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BACKEND_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  let data = null;
  try {
    data = await res.json();
  } catch {
    // Some endpoints (e.g. this backend's revoke/reset) return small JSON bodies too, so an
    // empty/non-JSON body here is a genuine unexpected-response case, not the normal path.
  }

  if (!res.ok) {
    const message = data?.error || `Request failed: ${res.status}`;
    const err = new Error(message);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  // GET /v1/health - no auth (see handleHealth's own comment on why a health probe can't require
  // one), real DB-liveness check (a trivial `SELECT COUNT(*) FROM tenants`, not just a ping).
  getHealth: () => request("/v1/health"),

  // POST /v1/auth/login - the one real credential this backend actually has today (a single
  // local admin password, see main.go's own comment on why not a full multi-user system yet).
  login: (password) => request("/v1/auth/login", { method: "POST", body: { password } }),

  listDevices: (token) => request(`/v1/tenants/${TENANT_ID}/devices`, { token }),
  listLiveStatus: (token) => request(`/v1/tenants/${TENANT_ID}/live-status`, { token }),
  listEvents: (token, limit = 100) => request(`/v1/tenants/${TENANT_ID}/events?limit=${limit}`, { token }),
  verifyEventChain: (token) => request(`/v1/tenants/${TENANT_ID}/events/verify-chain`, { token }),
  listNotifications: (token, limit = 50) => request(`/v1/tenants/${TENANT_ID}/notifications?limit=${limit}`, { token }),
  markAllNotificationsRead: (token) => request(`/v1/tenants/${TENANT_ID}/notifications/mark-all-read`, { method: "POST", token }),
  clearAllNotifications: (token) => request(`/v1/tenants/${TENANT_ID}/notifications/clear`, { method: "POST", token }),

  revokeDevice: (token, deviceId) => request(`/v1/devices/${deviceId}/revoke`, { method: "POST", token }),
  resetFingerprint: (token, deviceId) => request(`/v1/devices/${deviceId}/reset-fingerprint`, { method: "POST", token }),
  // PRD §6.4 Warranty State Machine - the real, human-confirmed adjudication step UnderReview/
  // Voided require (see backend/warranty.go's own comment). decision is "confirm-voided" or
  // "dismiss" (the latter reuses resetFingerprint's own real effect server-side).
  warrantyReview: (token, deviceId, decision) => request(`/v1/devices/${deviceId}/warranty-review`, { method: "POST", token, body: { decision } }),
  setDeviceTags: (token, deviceId, tags) => request(`/v1/devices/${deviceId}/tags`, { method: "POST", token, body: { tags } }),
  // PRD §9 Self-Healing v1 remote dispatch - real, but v1 allows only one pending command per
  // device at a time (backend 409s if one's already pending, see device_commands.go).
  enqueueCommand: (token, deviceId, action) => request(`/v1/devices/${deviceId}/commands`, { method: "POST", token, body: { action } }),

  // Real data that already existed device-scoped only, now exposed admin-wide (see backend's
  // live.go "Admin-facing views" section).
  getEntitlement: (token) => request(`/v1/tenants/${TENANT_ID}/entitlement`, { token }),
  getDeviceMetricSnapshots: (token, deviceId) => request(`/v1/tenants/${TENANT_ID}/devices/${deviceId}/metric-snapshots`, { token }),
  listApprovalRequests: (token) => request(`/v1/tenants/${TENANT_ID}/approval-requests`, { token }),
  approveRequest: (token, requestId) => request(`/v1/approval-requests/${requestId}/approve`, { method: "POST", token }),
  rejectRequest: (token, requestId) => request(`/v1/approval-requests/${requestId}/reject`, { method: "POST", token }),

  // Alert -> Incident workflow
  listIncidents: (token, status) => request(`/v1/tenants/${TENANT_ID}/incidents${status ? `?status=${status}` : ""}`, { token }),
  createIncident: (token, body) => request(`/v1/tenants/${TENANT_ID}/incidents`, { method: "POST", token, body }),
  getIncidentDetail: (token, incidentId) => request(`/v1/incidents/${incidentId}`, { token }),
  updateIncidentStatus: (token, incidentId, status) => request(`/v1/incidents/${incidentId}/status`, { method: "POST", token, body: { status } }),
  addIncidentNote: (token, incidentId, note) => request(`/v1/incidents/${incidentId}/notes`, { method: "POST", token, body: { note } }),

  // Remote Assist
  listRemoteSessions: (token) => request(`/v1/tenants/${TENANT_ID}/remote-sessions`, { token }),

  // Real, admin-configurable offline-detection threshold (backend/settings.go) - previously a
  // hardcoded Go constant, now readable/writable here.
  getOfflineThreshold: (token) => request(`/v1/tenants/${TENANT_ID}/settings/offline-threshold`, { token }),
  updateOfflineThreshold: (token, minutes) => request(`/v1/tenants/${TENANT_ID}/settings/offline-threshold`, { method: "PATCH", token, body: { minutes } }),

  // Real alert-rule CRUD (backend/alert_rules.go), evaluated against real live telemetry by
  // backend/alert_engine.go's own real sweep loop - not a client-side rule engine.
  listAlertRules: (token) => request(`/v1/tenants/${TENANT_ID}/alert-rules`, { token }),
  createAlertRule: (token, body) => request(`/v1/tenants/${TENANT_ID}/alert-rules`, { method: "POST", token, body }),
  updateAlertRule: (token, ruleId, body) => request(`/v1/alert-rules/${ruleId}`, { method: "PATCH", token, body }),
  deleteAlertRule: (token, ruleId) => request(`/v1/alert-rules/${ruleId}`, { method: "DELETE", token }),
};
