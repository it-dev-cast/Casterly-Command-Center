// Real device_id shape (backend/ids.go): "device_" + 16 lowercase hex characters from 8
// cryptographically random bytes - always present, always this exact shape, for every device,
// the moment it's first registered (unlike the hardware serial on Device 360's own Identity
// panel, which is only ever populated once a device has successfully reported live hardware
// detail - a device that's brand-new or offline may never have one). This is the one
// disambiguator guaranteed available everywhere a device is shown, borrowing the same
// device_id-as-unique-key principle the backend itself relies on - hostname is descriptive only,
// never unique (re-registration and cloned images both produce real hostname collisions).
export function shortDeviceTag(id) {
  if (!id) return "";
  const hex = id.replace(/^device_/, "");
  return `#${hex.slice(-6).toUpperCase()}`;
}
