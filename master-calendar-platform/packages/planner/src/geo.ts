export interface GeoPoint {
  lat: number;
  lng: number;
}

export interface PlannerPlace extends GeoPoint {
  id: string;
  name: string;
  /** Minutes to park and walk in (added on arrival). */
  arrivalBufferMinutes?: number;
  /** Opening hours in the workspace's time zone; errands here must fit inside them. Omitted = always open. */
  openHours?: { dayOfWeek: number; startMinute: number; endMinute: number }[];
}

/** Travel time between two places in minutes. Must be cheap: the organizer calls it a lot. */
export type TravelMinutes = (from: PlannerPlace, to: PlannerPlace) => number;

export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/**
 * Traffic-free estimate for planning a week ahead: straight-line distance × a road
 * factor at a suburban average speed, plus a few minutes to get going. Real traffic is
 * only fetched for today's plan and leave-by alerts, where it matters (and costs money).
 */
export function estimateDrivingMinutes(
  a: GeoPoint,
  b: GeoPoint,
  opts: { roadFactor?: number; avgKmh?: number; overheadMinutes?: number } = {},
): number {
  const km = haversineKm(a, b);
  if (km < 0.05) return 0;
  const { roadFactor = 1.35, avgKmh = 40, overheadMinutes = 3 } = opts;
  return Math.ceil((km * roadFactor * 60) / avgKmh + overheadMinutes);
}

export const estimatedTravel: TravelMinutes = (from, to) => (from.id === to.id ? 0 : estimateDrivingMinutes(from, to));
