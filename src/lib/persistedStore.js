import { useEffect, useState } from "react";

// Generic small pub-sub + localStorage store - shared by every cross-component client
// preference this app persists locally (notification category toggles, date/time/landing-page
// preferences). Plain per-component useState + localStorage (the pattern this app already used
// for things like sidebar-collapsed) is fine when only one component ever reads a value, but
// breaks the moment two components need the SAME live value (e.g. a toggle in Settings that must
// immediately affect NotificationBell, mounted elsewhere) - localStorage writes don't trigger
// React re-renders on their own. This is the minimal real fix: one shared value + a listener set,
// not a full Context provider for every single preference.
export function createPersistedStore(storageKey, defaultValue) {
  function load() {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw != null ? JSON.parse(raw) : defaultValue;
    } catch {
      return defaultValue;
    }
  }

  let value = load();
  const listeners = new Set();

  function get() {
    return value;
  }

  function set(next) {
    value = typeof next === "function" ? next(value) : next;
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      // Private-browsing/quota-related storage failure - non-fatal, matches every other
      // localStorage write elsewhere in this app.
    }
    listeners.forEach((l) => l(value));
  }

  function useStore() {
    const [state, setState] = useState(value);
    useEffect(() => {
      const listener = (v) => setState(v);
      listeners.add(listener);
      return () => listeners.delete(listener);
    }, []);
    return [state, set];
  }

  return { get, set, useStore };
}
