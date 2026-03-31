/**
 * Government Fuel Finder API client
 *
 * API: https://www.developer.fuel-finder.service.gov.uk
 * - Token: POST /api/v1/oauth/generate_access_token
 * - Stations: GET /api/v1/pfs?batch-number=N (500 per batch, 16 batches ~7,569 stations)
 * - Prices: GET /api/v1/pfs/fuel-prices?batch-number=N
 *
 * Fuel type codes: E10 (petrol), E5 (super unleaded), B7_STANDARD (diesel), SDV (premium diesel)
 * Prices are in pence per litre (e.g. 142.9)
 */

import { getDistanceMiles } from "./distance";

const BASE_URL = process.env.GOV_FUEL_API_URL || "https://www.developer.fuel-finder.service.gov.uk";
const TOKEN_URL = process.env.GOV_FUEL_TOKEN_URL || `${BASE_URL}/api/v1/oauth/generate_access_token`;

let cachedToken: { token: string; expiresAt: number } | null = null;

// Cache all station+price data for 15 minutes
let dataCache: { stations: FuelStation[]; fetchedAt: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000;

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const clientId = process.env.GOV_FUEL_CLIENT_ID;
  const clientSecret = process.env.GOV_FUEL_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Missing GOV_FUEL_CLIENT_ID or GOV_FUEL_CLIENT_SECRET");
  }

  const res = await fetch(TOKEN_URL, {
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
  const tokenData = data.data || data;
  cachedToken = {
    token: tokenData.access_token,
    expiresAt: Date.now() + (tokenData.expires_in || 3600) * 1000,
  };

  return cachedToken.token;
}

// --- Types matching actual API response ---

interface APIStation {
  node_id: string;
  trading_name: string;
  brand_name: string;
  location: {
    address_line_1: string;
    address_line_2: string;
    city: string;
    county: string;
    postcode: string;
    latitude: number;
    longitude: number;
  };
  fuel_types: string[];
  temporary_closure: boolean;
  permanent_closure: boolean | null;
}

interface APIPrice {
  node_id: string;
  fuel_prices: Array<{
    fuel_type: string;
    price: number;
    price_last_updated: string;
  }>;
}

export interface FuelPrice {
  fuel_type: string;
  price: number; // pence per litre
  updated_at: string;
}

export interface FuelStation {
  id: string;
  name: string;
  brand: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  prices: FuelPrice[];
  closed: boolean;
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

// Fuel type matching
const PETROL_CODES = ["E10", "E5"];
const DIESEL_CODES = ["B7", "SDV"];

export function matchesFuelType(
  fuelTypeCode: string,
  selectedType: "petrol" | "diesel"
): boolean {
  const upper = fuelTypeCode.toUpperCase().replace(/_STANDARD|_PREMIUM/g, "");
  const patterns = selectedType === "petrol" ? PETROL_CODES : DIESEL_CODES;
  return patterns.some((p) => upper.includes(p));
}

async function apiGet(path: string): Promise<unknown> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`API ${path} failed (${res.status}): ${text.slice(0, 200)}`);
  }

  return res.json();
}

/**
 * Fetch all stations and prices across all batches.
 * Caches for 15 minutes.
 */
async function fetchAllData(): Promise<FuelStation[]> {
  if (dataCache && Date.now() - dataCache.fetchedAt < CACHE_TTL) {
    return dataCache.stations;
  }

  // Fetch all batches of stations and prices in parallel
  const batchNumbers = Array.from({ length: 16 }, (_, i) => i + 1);

  const [stationBatches, priceBatches] = await Promise.all([
    Promise.all(
      batchNumbers.map((n) =>
        apiGet(`/api/v1/pfs?batch-number=${n}`)
          .then((data) => (Array.isArray(data) ? data : []) as APIStation[])
          .catch(() => [] as APIStation[])
      )
    ),
    Promise.all(
      batchNumbers.map((n) =>
        apiGet(`/api/v1/pfs/fuel-prices?batch-number=${n}`)
          .then((data) => (Array.isArray(data) ? data : []) as APIPrice[])
          .catch(() => [] as APIPrice[])
      )
    ),
  ]);

  const allStations = stationBatches.flat();
  const allPrices = priceBatches.flat();

  // Build price lookup by node_id
  const priceMap = new Map<string, FuelPrice[]>();
  for (const p of allPrices) {
    if (p.node_id && Array.isArray(p.fuel_prices)) {
      priceMap.set(
        p.node_id,
        p.fuel_prices.map((fp) => ({
          fuel_type: fp.fuel_type,
          price: fp.price,
          updated_at: fp.price_last_updated || "",
        }))
      );
    }
  }

  // Merge stations + prices
  const stations: FuelStation[] = allStations
    .filter((s) => s.node_id && s.location?.latitude && s.location?.longitude)
    .filter((s) => !s.temporary_closure && !s.permanent_closure)
    .map((s) => {
      const addr = [
        s.location.address_line_1,
        s.location.address_line_2,
        s.location.city,
        s.location.county,
      ]
        .filter(Boolean)
        .join(", ");

      return {
        id: s.node_id,
        name: s.trading_name,
        brand: s.brand_name || "Independent",
        address: addr,
        postcode: s.location.postcode,
        lat: s.location.latitude,
        lng: s.location.longitude,
        prices: priceMap.get(s.node_id) || [],
        closed: false,
      };
    });

  dataCache = { stations, fetchedAt: Date.now() };
  console.log(`Cached ${stations.length} stations with prices`);
  return stations;
}

/**
 * Get stations near a location within radiusMiles.
 */
export async function fetchNearbyStations(
  lat: number,
  lng: number,
  radiusMiles: number = 10
): Promise<FuelStation[]> {
  const allStations = await fetchAllData();

  return allStations.filter((s) => {
    const dist = getDistanceMiles(lat, lng, s.lat, s.lng);
    return dist <= radiusMiles;
  });
}
