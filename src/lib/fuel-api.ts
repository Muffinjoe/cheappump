/**
 * Government Fuel Finder API client
 *
 * Confirmed endpoints (from developer portal + community integrations):
 * - Token: POST /api/v1/oauth/generate_access_token
 * - Stations: GET /api/v1/pfs
 * - Prices: GET /api/v1/pfs/fuel-prices
 *
 * Fuel type codes from the API use underscored notation:
 * - B7_STANDARD → standard diesel
 * - E10_STANDARD → standard unleaded petrol
 * - E5_STANDARD → super unleaded petrol
 * - SDV_STANDARD → premium diesel
 */

import { getDistanceMiles } from "./distance";

let cachedToken: { token: string; expiresAt: number } | null = null;

// Cache stations + prices for 5 minutes (per developer guidelines)
let stationsCache: { data: FuelStation[]; fetchedAt: number } | null = null;
const CACHE_TTL = 5 * 60 * 1000;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const baseUrl =
    process.env.GOV_FUEL_API_URL || "https://api.fuelfinder.service.gov.uk";
  const tokenUrl =
    process.env.GOV_FUEL_TOKEN_URL ||
    `${baseUrl}/api/v1/oauth/generate_access_token`;
  const clientId = process.env.GOV_FUEL_CLIENT_ID;
  const clientSecret = process.env.GOV_FUEL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOV_FUEL_CLIENT_ID or GOV_FUEL_CLIENT_SECRET");
  }

  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: clientId,
      client_secret: clientSecret,
      scope: "fuelfinder.read",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();
  cachedToken = {
    token: data.access_token,
    expiresAt: Date.now() + (data.expires_in || 3600) * 1000,
  };

  return cachedToken.token;
}

export interface FuelPrice {
  fuel_type: string; // e.g. "E10", "B7", "E5", "SDV"
  price: number; // pence per litre
  updated_at?: string;
}

export interface FuelStation {
  id: string;
  name: string;
  brand: string;
  address?: string;
  postcode?: string;
  location: {
    latitude: number;
    longitude: number;
  };
  prices: FuelPrice[];
}

export interface StationResult {
  id: string;
  name: string;
  brand: string;
  address: string;
  lat: number;
  lng: number;
  price: number | null;
  fuelType: string;
  updatedAt: string | null;
  distanceMiles: number | null;
}

// Fuel type matching - API uses codes like B7_STANDARD, E10_STANDARD etc
const PETROL_PATTERNS = ["E10", "E5", "UNLEADED", "PETROL"];
const DIESEL_PATTERNS = ["B7", "SDV", "DIESEL"];

export function matchesFuelType(
  fuelTypeCode: string,
  selectedType: "petrol" | "diesel"
): boolean {
  const upper = fuelTypeCode.toUpperCase();
  const patterns =
    selectedType === "petrol" ? PETROL_PATTERNS : DIESEL_PATTERNS;
  return patterns.some((p) => upper.includes(p));
}

async function apiGet(path: string): Promise<Response> {
  const token = await getAccessToken();
  const baseUrl =
    process.env.GOV_FUEL_API_URL || "https://api.fuelfinder.service.gov.uk";

  return fetch(`${baseUrl}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });
}

/**
 * Fetch all stations with prices, with in-memory caching.
 * The API may not support location-based filtering natively,
 * so we fetch all and filter by distance client-side.
 */
async function fetchAllStations(): Promise<FuelStation[]> {
  if (stationsCache && Date.now() - stationsCache.fetchedAt < CACHE_TTL) {
    return stationsCache.data;
  }

  // Try fetching stations with embedded prices first
  const stationsRes = await apiGet("/api/v1/pfs");
  if (!stationsRes.ok) {
    const text = await stationsRes.text();
    throw new Error(
      `Stations API failed (${stationsRes.status}): ${text.slice(0, 200)}`
    );
  }

  const stationsData = await stationsRes.json();
  const rawStations = extractArray(stationsData);

  // Check if stations already have prices embedded
  const hasEmbeddedPrices =
    rawStations.length > 0 && hasNestedPrices(rawStations[0]);

  let stations = normalizeStations(rawStations);

  // If prices aren't embedded, fetch them separately and merge
  if (!hasEmbeddedPrices) {
    try {
      const pricesRes = await apiGet("/api/v1/pfs/fuel-prices");
      if (pricesRes.ok) {
        const pricesData = await pricesRes.json();
        const rawPrices = extractArray(pricesData);
        stations = mergePrices(stations, rawPrices);
      }
    } catch {
      // Continue with whatever prices we have
    }
  }

  stationsCache = { data: stations, fetchedAt: Date.now() };
  return stations;
}

/**
 * Get stations near a location, sorted/filtered as needed.
 */
export async function fetchNearbyStations(
  lat: number,
  lng: number,
  radiusMiles: number = 10
): Promise<FuelStation[]> {
  const allStations = await fetchAllStations();

  // Filter by distance
  return allStations.filter((s) => {
    if (!s.location.latitude || !s.location.longitude) return false;
    const dist = getDistanceMiles(
      lat,
      lng,
      s.location.latitude,
      s.location.longitude
    );
    return dist <= radiusMiles;
  });
}

// --- Helpers ---

function extractArray(data: unknown): Record<string, unknown>[] {
  if (Array.isArray(data)) return data;
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>;
    // Try common wrapper keys
    for (const key of [
      "stations",
      "results",
      "data",
      "items",
      "forecourts",
      "pfs",
    ]) {
      if (Array.isArray(obj[key])) return obj[key] as Record<string, unknown>[];
    }
  }
  return [];
}

function hasNestedPrices(item: Record<string, unknown>): boolean {
  return (
    Array.isArray(item.prices) ||
    Array.isArray(item.fuelPrices) ||
    Array.isArray(item.fuel_prices)
  );
}

function normalizeStations(raw: Record<string, unknown>[]): FuelStation[] {
  return raw
    .map((s) => {
      const loc =
        (s.location as Record<string, number>) ||
        (s.geo as Record<string, number>) ||
        (s.coordinates as Record<string, number>) ||
        {};

      const rawPrices =
        (s.prices as Record<string, unknown>[]) ||
        (s.fuelPrices as Record<string, unknown>[]) ||
        (s.fuel_prices as Record<string, unknown>[]) ||
        [];

      const prices: FuelPrice[] = rawPrices.map((p) => ({
        fuel_type: normalizeFuelCode(
          String(p.fuel_type || p.fuelType || p.type || p.grade || "unknown")
        ),
        price: toPence(p.price ?? p.amount ?? p.pence_per_litre ?? p.unitPrice ?? 0),
        updated_at: String(
          p.updated_at || p.updatedAt || p.timestamp || p.lastUpdated || ""
        ),
      }));

      return {
        id: String(s.id || s.station_id || s.siteId || s.pfsId || ""),
        name: String(
          s.name || s.site_name || s.siteName || s.brandName || "Unknown Station"
        ),
        brand: String(
          s.brand || s.operator || s.brandName || s.retailer || "Independent"
        ),
        address: String(s.address || s.street || s.full_address || s.addressLine || ""),
        postcode: String(s.postcode || s.post_code || s.zipCode || ""),
        location: {
          latitude: Number(
            loc.latitude || loc.lat || s.latitude || s.lat || 0
          ),
          longitude: Number(
            loc.longitude || loc.lng || loc.lon || s.longitude || s.lng || s.lon || 0
          ),
        },
        prices,
      };
    })
    .filter((s) => s.location.latitude !== 0 && s.location.longitude !== 0);
}

function mergePrices(
  stations: FuelStation[],
  rawPrices: Record<string, unknown>[]
): FuelStation[] {
  // Build a map of station ID → prices
  const priceMap = new Map<string, FuelPrice[]>();

  for (const p of rawPrices) {
    const stationId = String(
      p.station_id || p.stationId || p.siteId || p.pfsId || p.id || ""
    );
    if (!stationId) continue;

    const price: FuelPrice = {
      fuel_type: normalizeFuelCode(
        String(p.fuel_type || p.fuelType || p.type || p.grade || "unknown")
      ),
      price: toPence(p.price ?? p.amount ?? p.pence_per_litre ?? p.unitPrice ?? 0),
      updated_at: String(
        p.updated_at || p.updatedAt || p.timestamp || p.lastUpdated || ""
      ),
    };

    const existing = priceMap.get(stationId) || [];
    existing.push(price);
    priceMap.set(stationId, existing);
  }

  return stations.map((s) => ({
    ...s,
    prices: priceMap.get(s.id) || s.prices,
  }));
}

// Normalize codes like "B7_STANDARD" → "B7", "E10_STANDARD" → "E10"
function normalizeFuelCode(code: string): string {
  return code.replace(/_STANDARD|_PREMIUM/gi, "").trim();
}

// Convert to pence - handle if API returns pounds (< 5) vs pence (> 50)
function toPence(value: unknown): number {
  const num = Number(value);
  if (isNaN(num) || num === 0) return 0;
  // If value looks like pounds (e.g., 1.349), convert to pence
  if (num < 5) return Math.round(num * 1000) / 10;
  return num;
}
