// Real device liveness, derived client-side from the real device-offline/device-online events
// backend/offline_detection.go's 60s sweep already fires (wired in main.go) - not a new backend
// call, just reading the same event log every page already has. Deliberately distinct from
// "health" (healthFromLiveStatus in LiveDataContext.jsx), which only ever looks at the LAST
// reported CPU/RAM/Disk/Battery values with no recency check - a device can show healthy while
// having been silently offline for many minutes, since health never expires. Liveness is the
// other real signal: is this device still actually reachable right now.
//
// Single source of truth for all three consumers (Reports, Action Center, Dashboard) - don't
// duplicate this scan logic per page.
//
// Caveat, real and worth stating: `events` is this app's live in-memory buffer (fetched with a
// limit, capped at 200 as new SSE events arrive - see LiveDataContext.jsx), not the full backend
// history. A device whose last offline/online transition fell out of that buffer will be treated
// as "not currently known to be offline" rather than incorrectly guessed either way - the same
// honest-absence handling already used for incident source-event resolution.
//
// liveStatusByDevice (optional): if this device has posted live telemetry AFTER its latest
// device-offline event, it is reachable again even when a matching device-online event is
// missing from the buffer (common: the offline event stays in the 200-event window while the
// later online event is pushed out, or the agent resumed posting live-status before the
// detector's next sweep emitted device-online). A live-status row with updatedAt newer than
// that offline event is real proof of contact - do not keep showing "offline."
export function computeOfflineDeviceIds(events, liveStatusByDevice = {}) {
  const latestByDevice = new Map();
  for (const e of events) {
    if (e.eventType !== "device-offline" && e.eventType !== "device-online") continue;
    const existing = latestByDevice.get(e.deviceId);
    if (!existing || new Date(e.createdAt) > new Date(existing.createdAt)) {
      latestByDevice.set(e.deviceId, e);
    }
  }
  const offlineIds = new Set();
  for (const [deviceId, e] of latestByDevice) {
    if (e.eventType !== "device-offline") continue;
    const live = liveStatusByDevice[deviceId];
    if (live?.updatedAt && new Date(live.updatedAt) > new Date(e.createdAt)) continue;
    offlineIds.add(deviceId);
  }
  return offlineIds;
}

// Convenience wrapper most callers actually want: real offline devices, scoped to active devices
// only (a revoked device isn't expected to report at all - that's a different, already-real state,
// not "offline").
export function getOfflineDevices(devices, events, liveStatusByDevice = {}) {
  const offlineIds = computeOfflineDeviceIds(events, liveStatusByDevice);
  return devices.filter((d) => d.status === "active" && offlineIds.has(d.id));
}
