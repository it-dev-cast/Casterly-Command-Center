import { createPersistedStore } from "./persistedStore.js";

export const DATE_FORMATS = [
  { value: "MDY", label: "MM/DD/YYYY" },
  { value: "DMY", label: "DD/MM/YYYY" },
  { value: "ISO", label: "YYYY-MM-DD" },
];
export const TIME_FORMATS = [
  { value: "12h", label: "12-hour (AM/PM)" },
  { value: "24h", label: "24-hour" },
];
// Real top-level routes only, the same ones the sidebar actually links to - not every possible
// route (a device-detail or incident-detail page isn't a sensible landing page with no ID yet).
export const LANDING_PAGES = [
  { value: "/", label: "Dashboard" },
  { value: "/action-center", label: "Action Center" },
  { value: "/endpoints", label: "Endpoints" },
  { value: "/alerts", label: "Alerts" },
  { value: "/incidents", label: "Incidents" },
];

export const preferencesStore = createPersistedStore("casterly_preferences", {
  dateFormat: "MDY",
  timeFormat: "12h",
  landingPage: "/",
});

// Real, genuinely applied formatter - not a decorative preview only. Used by Settings' own live
// example and by the Activity & Audit recent-activity list, so the preference has a real,
// observable effect beyond the settings page itself.
export function formatWithPrefs(iso, prefs) {
  if (!iso) return "—";
  const d = new Date(iso);
  const pad = (n) => String(n).padStart(2, "0");

  let datePart;
  if (prefs.dateFormat === "DMY") datePart = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  else if (prefs.dateFormat === "ISO") datePart = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  else datePart = `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;

  let timePart;
  if (prefs.timeFormat === "24h") {
    timePart = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } else {
    let h = d.getHours() % 12;
    if (h === 0) h = 12;
    timePart = `${h}:${pad(d.getMinutes())} ${d.getHours() >= 12 ? "PM" : "AM"}`;
  }
  return `${datePart} ${timePart}`;
}
