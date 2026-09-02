// Real device liveness - deliberately distinct from "health" (healthFromLiveStatus in
// LiveDataContext.jsx), which only ever looks at the LAST reported CPU/RAM/Disk/Battery values
// with no recency check - a device can show healthy (or Critical) while having been silently
// offline for hours, since health never expires on its own. Liveness is the other real signal:
// is this device still actually reachable right now.
//
// computeOfflineDeviceIds is the exact same formula backend/offline_detection.go's own 60s sweep
// uses server-side to decide when to fire device-offline (see that file's isDeviceStale): the
// later of a device's own lastSeenAt and its live-status row's updatedAt (live telemetry every
// ~5s is as much real contact as the ~60s heartbeat), compared against the tenant's real,
// admin-configured threshold. Recomputed here directly from those same raw timestamps every
// device object already carries - not inferred from whether the sweep's one-time device-offline
// event still happens to be inside this app's live event buffer.
//
// That event-based approach was this function's previous implementation, and it had a real,
// confirmed gap: a device offline long enough for its own device-offline event to fall out of a
// busy fleet's most-recent-200-event window (this app's live SSE buffer, fed by an initial
// listEvents(token, 100) load) silently stopped being knowable as offline at all, no matter how
// stale it actually got - a device 41+ hours stale showed no Offline indicator anywhere, while
// still displaying its last (now meaningless) Critical/Warning reading as if current. Comparing
// directly against lastSeenAt/updatedAt has no such window - it's correct for a device that's
// been stale for two minutes or two months alike.
//
// `now` is a parameter, not Date.now() read internally, so callers (LiveDataContext) can force a
// fresh recomputation on a real tick even when no new data arrived - staleness is a fact about
// time passing, not about a new event showing up, so something has to re-evaluate it on an
// interval rather than only whenever devices/liveStatusByDevice themselves change.
//
// thresholdMinutes is the tenant's real, admin-configurable value (GET
// /v1/tenants/{id}/settings/offline-threshold - the same one Settings.jsx already lets an
// operator edit). null means "not loaded yet" - every device is honestly reported as not-known-
// offline rather than guessed either way, the same honest-absence handling this codebase already
// uses elsewhere (e.g. incident source-event resolution).
export function computeOfflineDeviceIds(devices, liveStatusByDevice = {}, thresholdMinutes, now = Date.now()) {
  const offlineIds = new Set();
  if (thresholdMinutes == null) return offlineIds;
  const thresholdMs = thresholdMinutes * 60 * 1000;
  for (const d of devices) {
    // Revoked devices aren't expected to report at all - that's a different, already-real
    // lifecycle state, not "offline" (same convention this file's callers already applied).
    if (d.status !== "active") continue;
    const lastSeenMs = d.lastSeenAt ? new Date(d.lastSeenAt).getTime() : null;
    const liveMs = liveStatusByDevice[d.id]?.updatedAt ? new Date(liveStatusByDevice[d.id].updatedAt).getTime() : null;
    const latestMs = liveMs == null ? lastSeenMs : lastSeenMs == null ? liveMs : Math.max(lastSeenMs, liveMs);
    const isStale = latestMs == null || now - latestMs > thresholdMs;
    if (isStale) offlineIds.add(d.id);
  }
  return offlineIds;
}

// Convenience wrapper most callers actually want: the real device objects that are currently
// offline (already scoped to active devices by computeOfflineDeviceIds above).
export function getOfflineDevices(devices, liveStatusByDevice = {}, thresholdMinutes, now = Date.now()) {
  const offlineIds = computeOfflineDeviceIds(devices, liveStatusByDevice, thresholdMinutes, now);
  return devices.filter((d) => offlineIds.has(d.id));
}

// deviceHealthDisplay is the one real bridge between health and liveness: a device's last real
// reading might have been Critical, but if it hasn't reported since, the honest thing to show is
// "stale," not a live-looking Critical banner claiming currency it doesn't have. Every display
// that shows a device's health should route it through this rather than using
// healthFromLiveStatus's return value directly - healthFromLiveStatus itself stays a pure "what
// did the last reading say" function (still meaningful on its own, e.g. for deriving what a
// stale device's frozen reading last was), it just isn't final display state on its own anymore.
export function deviceHealthDisplay(health, isOffline) {
  return isOffline ? "stale" : health;
}
