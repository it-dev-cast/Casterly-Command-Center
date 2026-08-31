// Parses this backend's real hardware-tamper-detected event message
// (handlers.go: `Hardware tamper detected on {hostname}: {field} changed from "{old}" to
// "{new}"; ...`) into a real per-field change list - structuring text the backend already wrote,
// not inventing data. compareFingerprints (backend/fingerprint.go) only ever computes a binary
// changed/unchanged per field - there's no NEW/REMOVED/UNKNOWN distinction anywhere in this
// backend - so every parsed row is honestly labeled CHANGED, never a status that isn't real.
// Shared by DeviceDetail.jsx's Hardware/Events tabs and IncidentDetail.jsx's hardware evidence -
// one parser, not a second independently-maintained copy.
export function parseHardwareChanges(message) {
  const body = message.split(": ").slice(1).join(": ").replace(/\.$/, "");
  return body
    .split("; ")
    .map((part) => {
      const m = part.match(/^(.+?) changed from "(.*)" to "(.*)"$/);
      return m ? { field: m[1], baseline: m[2], current: m[3] } : null;
    })
    .filter(Boolean);
}
