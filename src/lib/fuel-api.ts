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

const BASE_URL =
  process.env.GOV_FUEL_API_URL ||
  "https://www.developer.fuel-finder.service.gov.uk";
const TOKEN_URL =
  process.env.GOV_FUEL_TOKEN_URL ||
  `${BASE_URL}/api/v1/oauth/generate_access_token`;

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
  temporary_closure: boolean;
  permanent_closure: boolean | null;
  location: {
    address_line_1: string;
    address_line_2: string;
    city: string;
    county: string;
    postcode: string;
    latitude: number;
    longitude: number;
  };
}

interface APIPriceEntry {
  fuel_type: string;
  price: number;
  price_last_updated: string;
}

interface APIPriceStation {
  node_id: string;
  fuel_prices: APIPriceEntry[];
}

export interface FuelPrice {
  fuel_type: string;
  price: number;
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

/**
 * Fetch a single batch with a pre-obtained token.
 */
async function fetchBatch(
  path: string,
  token: string
): Promise<unknown[]> {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    console.error(`API ${path} returned ${res.status}`);
    return [];
  }

  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

/**
 * Fetch all stations and prices across all batches.
 * Uses sequential groups of 8 to stay within rate limits.
 * Caches for 15 minutes.
 */
async function fetchAllData(): Promise<FuelStation[]> {
  if (dataCache && Date.now() - dataCache.fetchedAt < CACHE_TTL) {
    return dataCache.stations;
  }

  // Get token once upfront
  const token = await getAccessToken();

  const batchNumbers = Array.from({ length: 16 }, (_, i) => i + 1);

  // Fetch stations in 2 waves of 8 to stay under 30 RPM
  const allStations: APIStation[] = [];
  for (let i = 0; i < batchNumbers.length; i += 8) {
    const chunk = batchNumbers.slice(i, i + 8);
    const results = await Promise.all(
      chunk.map((n) =>
        fetchBatch(`/api/v1/pfs?batch-number=${n}`, token)
      )
    );
    for (const batch of results) {
      allStations.push(...(batch as APIStation[]));
    }
  }

  console.log(`Fetched ${allStations.length} stations`);

  // Fetch prices in 2 waves of 8
  const allPrices: APIPriceStation[] = [];
  for (let i = 0; i < batchNumbers.length; i += 8) {
    const chunk = batchNumbers.slice(i, i + 8);
    const results = await Promise.all(
      chunk.map((n) =>
        fetchBatch(`/api/v1/pfs/fuel-prices?batch-number=${n}`, token)
      )
    );
    for (const batch of results) {
      allPrices.push(...(batch as APIPriceStation[]));
    }
  }

  console.log(`Fetched ${allPrices.length} price entries`);

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
    .filter(
      (s) =>
        s.node_id &&
        s.location?.latitude &&
        s.location?.longitude &&
        !s.temporary_closure &&
        !s.permanent_closure
    )
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
