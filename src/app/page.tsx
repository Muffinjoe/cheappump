"use client";

import { useState, useEffect, FormEvent } from "react";
import { StationCard } from "@/components/StationCard";
import { StationResult } from "@/lib/fuel-api";

const BRANDS = [
  { value: "all", label: "All brands" },
  { value: "bp", label: "BP" },
  { value: "shell", label: "Shell" },
  { value: "esso", label: "Esso" },
  { value: "tesco", label: "Tesco" },
  { value: "asda", label: "Asda" },
  { value: "sainsbury", label: "Sainsbury's" },
  { value: "morrisons", label: "Morrisons" },
];

interface SearchResults {
  location: string;
  fuelType: string;
  cheapest: { name: string; brand: string; price: number } | null;
  results: StationResult[];
  count: number;
}

export default function Home() {
  const [location, setLocation] = useState("");
  const [fuelType, setFuelType] = useState<"petrol" | "diesel">("petrol");
  const [brand, setBrand] = useState("all");
  const [sort, setSort] = useState<"price" | "distance">("price");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SearchResults | null>(null);
  const [geoLoading, setGeoLoading] = useState(false);
  const [copied, setCopied] = useState(false);

  // Load search from URL params (for shared links)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const loc = params.get("location");
    if (loc) {
      const fuel = (params.get("fuel") as "petrol" | "diesel") || "petrol";
      const br = params.get("brand") || "all";
      const s = (params.get("sort") as "price" | "distance") || "price";
      setLocation(loc);
      setFuelType(fuel);
      setBrand(br);
      setSort(s);
      doSearch(loc, fuel, br, s);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doSearch(
    loc: string,
    fuel: string,
    br: string,
    s: string
  ) {
    if (!loc.trim()) return;
    setLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams({
        location: loc.trim(),
        fuel,
        brand: br,
        sort: s,
      });

      const res = await fetch(`/api/search?${params}`);
      const json = await res.json();

      if (!res.ok) {
        setError(json.error || "Something went wrong");
        setData(null);
      } else {
        setData(json);
        setError(null);
        // Update URL for sharing
        const shareParams = new URLSearchParams({ location: loc.trim(), fuel, brand: br, sort: s });
        window.history.replaceState(null, "", `?${shareParams}`);
      }
    } catch {
      setError("Failed to search. Please check your connection and try again.");
      setData(null);
    } finally {
      setLoading(false);
    }
  }

  function handleSearch(e?: FormEvent) {
    e?.preventDefault();
    doSearch(location, fuelType, brand, sort);
  }

  function handleUseMyLocation() {
    if (!navigator.geolocation) {
      setError("Geolocation is not supported by your browser");
      return;
    }
    setGeoLoading(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const res = await fetch(
            `https://api.postcodes.io/postcodes?lon=${pos.coords.longitude}&lat=${pos.coords.latitude}&limit=1`
          );
          const json = await res.json();
          if (json.result && json.result.length > 0) {
            const pc = json.result[0].postcode;
            setLocation(pc);
            setGeoLoading(false);
            doSearch(pc, fuelType, brand, sort);
          } else {
            setGeoLoading(false);
            setError("Could not determine your postcode. Please enter one manually.");
          }
        } catch {
          setGeoLoading(false);
          setError("Could not determine your postcode. Please enter one manually.");
        }
      },
      () => {
        setError("Could not get your location. Please enter a postcode instead.");
        setGeoLoading(false);
      },
      { enableHighAccuracy: false, timeout: 10000 }
    );
  }

  function handleFilterChange(
    newFuel?: "petrol" | "diesel",
    newBrand?: string,
    newSort?: "price" | "distance"
  ) {
    const f = newFuel ?? fuelType;
    const b = newBrand ?? brand;
    const s = newSort ?? sort;
    if (newFuel !== undefined) setFuelType(f);
    if (newBrand !== undefined) setBrand(b);
    if (newSort !== undefined) setSort(s);

    if (location.trim() && data) {
      doSearch(location, f, b, s);
    }
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-2xl mx-auto px-4 py-4 flex items-center justify-center gap-2">
          <a href="/" className="flex items-center gap-2">
            <img src="/fuel-pump.png" alt="" className="h-6 w-6" />
            <h1 className="text-xl font-bold text-gray-900">
              Cheap<span className="text-green-600">Pump</span>
              <span className="text-sm font-normal text-gray-400 ml-1">.co.uk</span>
            </h1>
          </a>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6">
        {/* Hero - only show before first search */}
        {!data && !error && (
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-gray-900 sm:text-4xl">
              Find the cheapest fuel near you
            </h2>
            <p className="mt-2 text-lg text-gray-500">
              Compare petrol and diesel prices across the UK in seconds.
            </p>
            <p className="mt-1 text-sm text-gray-400">
              Stop getting rinsed at the pump.
            </p>
          </div>
        )}

        {/* Search Form */}
        <form
          onSubmit={handleSearch}
          className="sticky top-0 z-10 bg-gray-50 pb-4 pt-2"
        >
          <div className="rounded-xl bg-white p-4 shadow-sm border border-gray-200">
            <div className="flex gap-2">
              <input
                type="text"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                placeholder="Enter full postcode (e.g. SW1A 1AA)"
                className="w-full rounded-lg border border-gray-300 px-4 py-3 text-gray-900 placeholder-gray-400 focus:border-green-500 focus:outline-none focus:ring-1 focus:ring-green-500"
              />
              <button
                type="submit"
                disabled={loading || !location.trim()}
                className="rounded-lg bg-green-600 px-5 py-3 font-semibold text-white hover:bg-green-700 disabled:opacity-50 transition-colors shrink-0"
              >
                {loading ? (
                  <svg className="h-5 w-5 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
                    <path fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" className="opacity-75" />
                  </svg>
                ) : (
                  "Find cheapest"
                )}
              </button>
            </div>

            <button
              type="button"
              onClick={handleUseMyLocation}
              disabled={geoLoading}
              className="mt-2 flex items-center gap-1 text-sm text-green-600 hover:text-green-700"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 10.5a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
              </svg>
              {geoLoading ? "Finding your location..." : "Use my location"}
            </button>

            {/* Filters */}
            <div className="mt-3 flex flex-wrap gap-2">
              <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleFilterChange("petrol")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    fuelType === "petrol"
                      ? "bg-green-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Petrol
                </button>
                <button
                  type="button"
                  onClick={() => handleFilterChange("diesel")}
                  className={`px-4 py-2 text-sm font-medium transition-colors ${
                    fuelType === "diesel"
                      ? "bg-green-600 text-white"
                      : "bg-white text-gray-700 hover:bg-gray-50"
                  }`}
                >
                  Diesel
                </button>
              </div>

              <select
                value={brand}
                onChange={(e) => handleFilterChange(undefined, e.target.value)}
                className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-700 focus:border-green-500 focus:outline-none"
              >
                {BRANDS.map((b) => (
                  <option key={b.value} value={b.value}>
                    {b.label}
                  </option>
                ))}
              </select>

              {data && (
                <div className="flex rounded-lg border border-gray-300 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleFilterChange(undefined, undefined, "price")}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${
                      sort === "price"
                        ? "bg-gray-800 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Cheapest
                  </button>
                  <button
                    type="button"
                    onClick={() => handleFilterChange(undefined, undefined, "distance")}
                    className={`px-3 py-2 text-sm font-medium transition-colors ${
                      sort === "distance"
                        ? "bg-gray-800 text-white"
                        : "bg-white text-gray-700 hover:bg-gray-50"
                    }`}
                  >
                    Nearest
                  </button>
                </div>
              )}
            </div>
          </div>
        </form>

        {/* Error */}
        {error && (
          <div className="mt-4 rounded-lg bg-red-50 border border-red-200 p-4 text-sm text-red-700">
            {error}
          </div>
        )}

        {/* Results */}
        {data && (
          <div className="mt-2 space-y-4">
            {data.cheapest && sort === "price" && (() => {
              const prices = data.results
                .map((s: StationResult) => s.price)
                .filter((p: number | null): p is number => p !== null);
              const mostExpensive = prices.length > 1 ? Math.max(...prices) : null;
              const saving = mostExpensive !== null
                ? ((mostExpensive - data.cheapest.price) * 50) / 100
                : null;

              return (
                <div className="rounded-lg bg-green-50 border border-green-200 p-4">
                  <p className="text-sm font-medium text-green-800">
                    Cheapest {fuelType} near {data.location}:{" "}
                    <span className="font-bold">
                      {data.cheapest.price.toFixed(1)}p
                    </span>{" "}
                    at {data.cheapest.brand} ({data.cheapest.name})
                  </p>
                  {saving !== null && saving > 0 && (
                    <>
                      <p className="mt-1 text-xs text-green-700">
                        Save ~£{saving.toFixed(saving >= 1 ? 2 : 2)} per tank vs the most expensive nearby
                      </p>
                      <p className="mt-0.5 text-xs text-green-600/60">
                        Based on a 50L tank
                      </p>
                    </>
                  )}
                </div>
              );
            })()}

            <div className="flex items-center justify-between">
              <p className="text-sm text-gray-500">
                {data.count} station{data.count !== 1 ? "s" : ""} found near{" "}
                {data.location}
              </p>
              <button
                type="button"
                onClick={() => {
                  const url = window.location.href;
                  if (navigator.share) {
                    navigator.share({
                      title: `Cheapest ${fuelType} near ${data.location}`,
                      text: data.cheapest
                        ? `Cheapest ${fuelType} near ${data.location}: ${data.cheapest.price.toFixed(1)}p at ${data.cheapest.brand}`
                        : `Fuel prices near ${data.location}`,
                      url,
                    }).catch(() => {});
                  } else {
                    navigator.clipboard.writeText(url);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }
                }}
                className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-600 transition-colors"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 1 0 0 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186 9.566-5.314m-9.566 7.5 9.566 5.314m0-12.814a2.25 2.25 0 1 0 0-2.186m0 2.186a2.25 2.25 0 1 0 0 2.186m0-2.186c-.18.324-.283.696-.283 1.093s.103.77.283 1.093" />
                </svg>
                {copied ? "Link copied!" : "Share"}
              </button>
            </div>

            <div className="space-y-3">
              {data.results.map((station: StationResult, i: number) => (
                <StationCard
                  key={station.id || i}
                  station={station}
                  isCheapest={i === 0 && sort === "price"}
                />
              ))}
            </div>

            {data.results.length === 0 && (
              <div className="text-center py-8 text-gray-500">
                <p className="text-lg font-medium">No stations found</p>
                <p className="mt-1 text-sm">
                  Try a different location, fuel type, or brand filter.
                </p>
              </div>
            )}
          </div>
        )}

        <footer className="mt-12 border-t border-gray-200 pt-6 pb-8 text-center text-xs text-gray-400">
          <p>
            CheapPump.co.uk — Data from the{" "}
            <a
              href="https://www.gov.uk"
              className="underline hover:text-gray-600"
              target="_blank"
              rel="noopener noreferrer"
            >
              UK Government fuel price service
            </a>
            . Prices may be slightly delayed.
          </p>
        </footer>
      </main>
    </div>
  );
}
