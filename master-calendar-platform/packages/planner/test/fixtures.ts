import { estimatedTravel, zonedToUtc, type OrganizerParticipant, type PlannerPlace } from "../src/index.js";

export const TZ = "America/Chicago";
// Real-ish Chicago geometry: park + Target ~0.4 km apart, ~4.5 km north of home; Goodwill ~4.5 km south.
export const home: PlannerPlace = { id: "home", name: "Home", lat: 41.9, lng: -87.65 };
export const park: PlannerPlace = { id: "park", name: "Eastside Park", lat: 41.94, lng: -87.65, arrivalBufferMinutes: 5 };
export const target: PlannerPlace = { id: "target", name: "Target", lat: 41.943, lng: -87.652, arrivalBufferMinutes: 5 };
export const hardware: PlannerPlace = { id: "hardware", name: "Ace Hardware", lat: 41.945, lng: -87.648 };
export const goodwill: PlannerPlace = { id: "goodwill", name: "Goodwill", lat: 41.86, lng: -87.65 };

/** Local wall time in Chicago → UTC Date. Week of Mon 2026-10-05. */
export const at = (month: number, day: number, hh: number, mm = 0) => zonedToUtc(2026, month, day, hh * 60 + mm, TZ);

export const weekdays = (startH: number, endH: number) =>
  [1, 2, 3, 4, 5].map((dayOfWeek) => ({ dayOfWeek, startMinute: startH * 60, endMinute: endH * 60 }));
export const weekend = (startH: number, endH: number) =>
  [0, 6].map((dayOfWeek) => ({ dayOfWeek, startMinute: startH * 60, endMinute: endH * 60 }));

export const alex: OrganizerParticipant = {
  id: "alex",
  name: "Alex",
  home,
  canDrive: true,
  takesUnassignedTasks: true,
  availability: [...weekdays(16, 21), ...weekend(8, 18)],
  maxTaskMinutesPerDay: 120,
};
export const maya: OrganizerParticipant = {
  id: "maya",
  name: "Maya",
  home,
  canDrive: false,
  takesUnassignedTasks: false,
  availability: [...weekdays(15, 20), ...weekend(9, 17)],
  maxTaskMinutesPerDay: 45,
};

export const base = { timeZone: TZ, travelMinutes: estimatedTravel, now: at(10, 1, 0) };
