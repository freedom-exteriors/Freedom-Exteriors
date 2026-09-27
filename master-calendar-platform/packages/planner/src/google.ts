// Google Maps Platform clients: Routes API (traffic-aware drive times) and Geocoding API
// (turning "Eastside Park Field 3" into coordinates). Server-side only — the key is secret.
import type { GeoPoint } from "./geo.js";
import type { TrafficEstimate, TrafficProvider } from "./departure.js";

type Fetch = typeof fetch;

export class GoogleRoutesTrafficProvider implements TrafficProvider {
  constructor(
    private readonly apiKey: string,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  async drivingMinutes(origin: GeoPoint, destination: GeoPoint, departAt: Date): Promise<TrafficEstimate> {
    const res = await this.fetchImpl("https://routes.googleapis.com/directions/v2:computeRoutes", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": this.apiKey,
        // Only ask for what we use — the field mask also decides the billing tier.
        "X-Goog-FieldMask": "routes.duration,routes.staticDuration",
      },
      body: JSON.stringify({
        origin: { location: { latLng: { latitude: origin.lat, longitude: origin.lng } } },
        destination: { location: { latLng: { latitude: destination.lat, longitude: destination.lng } } },
        travelMode: "DRIVE",
        routingPreference: "TRAFFIC_AWARE_OPTIMAL",
        departureTime: departAt.toISOString(),
      }),
    });
    if (!res.ok) throw new Error(`Routes API ${res.status}: ${await res.text()}`);
    const data = (await res.json()) as { routes?: { duration?: string; staticDuration?: string }[] };
    const route = data.routes?.[0];
    if (!route?.duration) throw new Error("Routes API returned no route");
    const traffic = secondsToMinutes(route.duration);
    return { trafficMinutes: traffic, typicalMinutes: route.staticDuration ? secondsToMinutes(route.staticDuration) : traffic };
  }
}

/** "1234s" → 21 (rounded up). */
function secondsToMinutes(duration: string): number {
  return Math.ceil(Number.parseFloat(duration.replace(/s$/, "")) / 60);
}

export interface GeocodeResult extends GeoPoint {
  formattedAddress: string;
  googlePlaceId: string;
}

/** Returns null when Google finds nothing; callers then ask a person to pick the place. */
export async function geocodeAddress(
  address: string,
  apiKey: string,
  opts: { fetchImpl?: Fetch; near?: GeoPoint } = {},
): Promise<GeocodeResult | null> {
  const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
  url.searchParams.set("address", address);
  url.searchParams.set("key", apiKey);
  if (opts.near) {
    // Bias toward the household's area: "Eastside Park" exists in many cities.
    const d = 0.5;
    url.searchParams.set("bounds", `${opts.near.lat - d},${opts.near.lng - d}|${opts.near.lat + d},${opts.near.lng + d}`);
  }
  const res = await (opts.fetchImpl ?? fetch)(url);
  if (!res.ok) throw new Error(`Geocoding API ${res.status}`);
  const data = (await res.json()) as {
    status: string;
    results: { formatted_address: string; place_id: string; geometry: { location: { lat: number; lng: number } } }[];
  };
  if (data.status === "ZERO_RESULTS") return null;
  if (data.status !== "OK") throw new Error(`Geocoding API status ${data.status}`);
  const r = data.results[0]!;
  return { lat: r.geometry.location.lat, lng: r.geometry.location.lng, formattedAddress: r.formatted_address, googlePlaceId: r.place_id };
}
