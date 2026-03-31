#!/usr/bin/env node

/**
 * Fetches all UK fuel station data from the Government Fuel Finder API
 * and writes a compact JSON file to public/data/stations.json.
 *
 * Run daily via cron or GitHub Action.
 *
 * Usage: node scripts/fetch-stations.mjs
 *
 * Env vars required:
 *   GOV_FUEL_CLIENT_ID
 *   GOV_FUEL_CLIENT_SECRET
 */

const CLIENT_ID = process.env.GOV_FUEL_CLIENT_ID;
const CLIENT_SECRET = process.env.GOV_FUEL_CLIENT_SECRET;
const BASE_URL = process.env.GOV_FUEL_API_URL || "https://www.developer.fuel-finder.service.gov.uk";
const TOKEN_URL = process.env.GOV_FUEL_TOKEN_URL || `${BASE_URL}/api/v1/oauth/generate_access_token`;

import { writeFileSync, mkdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, "..", "public", "data");
const OUT_FILE = join(OUT_DIR, "stations.json");

async function getToken() {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "client_credentials",
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      scope: "fuelfinder.read",
    }),
  });

  if (!res.ok) throw new Error(`Token failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return (data.data || data).access_token;
}

async function fetchBatch(path, token) {
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    console.error(`  WARN: ${path} returned ${res.status}`);
    return [];
  }
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

async function main() {
  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error("Missing GOV_FUEL_CLIENT_ID or GOV_FUEL_CLIENT_SECRET");
    process.exit(1);
  }

  console.log("Fetching access token...");
  const token = await getToken();

  const batches = Array.from({ length: 16 }, (_, i) => i + 1);
  const allStations = [];
  const allPrices = [];

  // Fetch in waves of 8 to stay under rate limits
  for (let i = 0; i < batches.length; i += 8) {
    const chunk = batches.slice(i, i + 8);
    console.log(`Fetching batches ${chunk[0]}-${chunk[chunk.length - 1]}...`);

    const [stationBatches, priceBatches] = await Promise.all([
      Promise.all(chunk.map((n) => fetchBatch(`/api/v1/pfs?batch-number=${n}`, token))),
      Promise.all(chunk.map((n) => fetchBatch(`/api/v1/pfs/fuel-prices?batch-number=${n}`, token))),
    ]);

    stationBatches.forEach((b) => allStations.push(...b));
    priceBatches.forEach((b) => allPrices.push(...b));
  }

  console.log(`Fetched ${allStations.length} stations, ${allPrices.length} price records`);

  // Build price lookup
  const priceMap = new Map();
  for (const p of allPrices) {
    if (p.node_id && Array.isArray(p.fuel_prices)) {
      priceMap.set(p.node_id, p.fuel_prices);
    }
  }

  // Merge into compact format
  const stations = allStations
    .filter(
      (s) =>
        s.node_id &&
        s.location?.latitude &&
        s.location?.longitude &&
        !s.temporary_closure &&
        !s.permanent_closure
    )
    .map((s) => ({
      id: s.node_id,
      n: s.trading_name,
      b: s.brand_name || "",
      a: [s.location.address_line_1, s.location.address_line_2, s.location.city]
        .filter(Boolean)
        .join(", "),
      pc: s.location.postcode,
      lat: s.location.latitude,
      lng: s.location.longitude,
      p: (priceMap.get(s.node_id) || []).map((fp) => ({
        t: fp.fuel_type,
        // Some stations report in pounds (e.g. 1.309) instead of pence (130.9)
        p: fp.price < 10 ? Math.round(fp.price * 1000) / 10 : fp.price,
        u: fp.price_last_updated || "",
      })),
    }));

  const output = {
    updated: new Date().toISOString(),
    count: stations.length,
    stations,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(output));

  const sizeMB = (JSON.stringify(output).length / 1024 / 1024).toFixed(2);
  console.log(`Wrote ${stations.length} stations to ${OUT_FILE} (${sizeMB} MB)`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
