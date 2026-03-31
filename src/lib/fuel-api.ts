/**
 * Fuel station data client
 *
 * Reads pre-fetched station data from /public/data/stations.json
 * (generated daily by scripts/fetch-stations.mjs)
 *
 * No API calls at request time - all data is static.
 */

import { getDistanceMiles } from "./distance";
import { readFileSync } from "fs";
import { join } from "path";

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

// Compact JSON format from fetch script
interface CompactStation {
  id: string;
  n: string;
  b: string;
  a: string;
  pc: string;
  lat: number;
  lng: number;
  p: Array<{ t: string; p: number; u: string }>;
}

interface StationData {
  updated: string;
  count: number;
  stations: CompactStation[];
}

// In-memory cache of expanded stations
let cache: { stations: FuelStation[]; updated: string } | null = null;

function loadStations(): { stations: FuelStation[]; updated: string } {
  if (cache) return cache;

  const filePath = join(process.cwd(), "public", "data", "stations.json");
  const raw: StationData = JSON.parse(readFileSync(filePath, "utf-8"));

  const stations: FuelStation[] = raw.stations.map((s) => ({
    id: s.id,
    name: s.n,
    brand: s.b || "Independent",
    address: s.a,
    postcode: s.pc,
    lat: s.lat,
    lng: s.lng,
    prices: s.p.map((fp) => ({
      fuel_type: fp.t,
      price: fp.p,
      updated_at: fp.u,
    })),
  }));

  cache = { stations, updated: raw.updated };
  console.log(`Loaded ${stations.length} stations (data from ${raw.updated})`);
  return cache;
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

export function getDataTimestamp(): string {
  return loadStations().updated;
}

export async function fetchNearbyStations(
  lat: number,
  lng: number,
  radiusMiles: number = 10
): Promise<FuelStation[]> {
  const { stations } = loadStations();

  return stations.filter((s) => {
    const dist = getDistanceMiles(lat, lng, s.lat, s.lng);
    return dist <= radiusMiles;
  });
}
