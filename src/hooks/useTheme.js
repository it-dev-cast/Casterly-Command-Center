import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "casterly_theme";
const listeners = new Set();

// Stored ids stay "light"/"dark" so existing preferences keep working. Labels match the
// NEXUS named-theme inventory. canvas/accent drive picker swatches without nested data-theme.
export const THEME_REGISTRY = [
  { id: "dark", label: "Graphite Dark", family: "dark", canvas: "#030712", accent: "#22d3ee" },
  { id: "midnight-blue", label: "Midnight Blue", family: "dark", canvas: "#060c1e", accent: "#4f8bff" },
  { id: "light", label: "Casterly Light", family: "light", canvas: "#e8eef2", accent: "#0a6478" },
  { id: "executive-white", label: "Executive White", family: "light", canvas: "#ececec", accent: "#3d5a73" },
  { id: "ocean-blue", label: "Ocean Blue", family: "light", canvas: "#d7e6f4", accent: "#1e5fa8" },
  { id: "slate-professional", label: "Slate Professional", family: "light", canvas: "#dce2e8", accent: "#46607a" },
  { id: "emerald", label: "Emerald", family: "light", canvas: "#d7eee3", accent: "#0a7d58" },
  { id: "purple-enterprise", label: "Purple Enterprise", family: "light", canvas: "#e4dcf2", accent: "#6b3fa0" },
  { id: "casterly-erp-green", label: "Casterly ERP Green", family: "light", canvas: "#d8e6dc", accent: "#1f7a52" },
];
const VALID_IDS = new Set([...THEME_REGISTRY.map((t) => t.id), "system"]);
export const THEME_FAMILY = Object.fromEntries(THEME_REGISTRY.map((t) => [t.id, t.family]));

function getStoredTheme() {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return VALID_IDS.has(v) ? v : "dark";
  } catch {
    return "dark";
  }
}

function systemPrefersDark() {
  return typeof window !== "undefined" && !!window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

export function effectiveThemeId(theme) {
  if (theme !== "system") return theme;
  return systemPrefersDark() ? "dark" : "light";
}

export function themeFamilyOf(theme) {
  return THEME_FAMILY[effectiveThemeId(theme)] || "light";
}

function applyTheme(theme) {
  const effective = effectiveThemeId(theme);
  const family = THEME_FAMILY[effective] || "light";
  const root = document.documentElement;
  if (family === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
  root.setAttribute("data-theme", effective);
  root.setAttribute("data-theme-family", family);
  root.style.colorScheme = family;
}

let currentTheme = getStoredTheme();
applyTheme(currentTheme);

function setGlobalTheme(next) {
  currentTheme = next;
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    // Private-browsing/quota-related storage failure - non-fatal.
  }
  applyTheme(next);
  listeners.forEach((l) => l(next));
}

export function useTheme() {
  const [theme, setLocalTheme] = useState(currentTheme);

  useEffect(() => {
    const listener = (t) => setLocalTheme(t);
    listeners.add(listener);
    return () => listeners.delete(listener);
  }, []);

  useEffect(() => {
    if (theme !== "system" || typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme("system");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  const toggleTheme = useCallback(() => {
    const effective = effectiveThemeId(currentTheme);
    setGlobalTheme(THEME_FAMILY[effective] === "dark" ? "light" : "dark");
  }, []);

  const setTheme = useCallback((next) => setGlobalTheme(next), []);

  return { theme, toggleTheme, setTheme, family: themeFamilyOf(theme) };
}
