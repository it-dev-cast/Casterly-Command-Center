import { useEffect, useRef } from "react";

// This backend pushes incident/approval-request changes over the same live SSE `event` stream
// every page already reads (see backend/incidents.go's own "incident-created"/
// "incident-status-changed" and backend/handlers.go's "approval-requested-*"/
// "approval-approved-*"/"approval-rejected-*" - there's no dedicated push message for either
// entity, see live.go's publishLiveStatus/publishEvent, the only two kinds that exist). Pages
// showing incidents/approvals were reading that real signal already (useLiveData().events) but
// never using it to know their own REST-fetched incident/approval list had gone stale - this is
// the one real bridge: watch the already-live events array for a newly-arrived matching row and
// re-run the caller's existing fetch, instead of the page just fetching once on mount forever.
//
// matchFn/onFetch are read through a ref so callers don't need to memoize them - each render just
// captures whatever token/id/state that render closed over, and the freshest version runs the
// moment a genuinely new matching event arrives.
export function useRefetchOnEvent(events, matchFn, onFetch) {
  const seenIdsRef = useRef(new Set());
  const primedRef = useRef(false);
  const matchFnRef = useRef(matchFn);
  const onFetchRef = useRef(onFetch);
  matchFnRef.current = matchFn;
  onFetchRef.current = onFetch;

  useEffect(() => {
    // First run just records what's already in the buffer - a freshly mounted page already loads
    // its own current state via its own initial fetch, so replaying every already-buffered event
    // here would just refetch once per pre-existing row for no reason.
    if (!primedRef.current) {
      events.forEach((e) => seenIdsRef.current.add(e.id));
      primedRef.current = true;
      return;
    }
    let matched = false;
    for (const e of events) {
      if (seenIdsRef.current.has(e.id)) continue;
      seenIdsRef.current.add(e.id);
      if (matchFnRef.current(e)) matched = true;
    }
    if (matched) onFetchRef.current();
  }, [events]);
}

export const isIncidentEvent = (e) => e.eventType === "incident-created" || e.eventType === "incident-status-changed";
export const isApprovalEvent = (e) =>
  e.eventType.startsWith("approval-requested-") ||
  e.eventType.startsWith("approval-approved-") ||
  e.eventType.startsWith("approval-rejected-");
