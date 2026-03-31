import { NextRequest, NextResponse } from "next/server";
import { geocodeLocation } from "@/lib/geocode";
import { fetchNearbyStations, matchesFuelType, getDataTimestamp, StationResult } from "@/lib/fuel-api";
import { getDistanceMiles } from "@/lib/distance";

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const location = searchParams.get("location");
  const fuelType = (searchParams.get("fuel") || "petrol") as "petrol" | "diesel";
  const brand = searchParams.get("brand") || "all";
  const sort = searchParams.get("sort") || "price"; // "price" or "distance"

  if (!location) {
    return NextResponse.json(
      { error: "Please enter a postcode or location" },
      { status: 400 }
    );
  }

  // Geocode
  const geo = await geocodeLocation(location);
  if (!geo) {
    return NextResponse.json(
      { error: "Please enter a full UK postcode (e.g. SW1A 1AA). Partial postcodes won't work." },
      { status: 400 }
    );
  }

  // Fetch stations
  let stations;
  try {
    stations = await fetchNearbyStations(geo.lat, geo.lng, 10);
  } catch (err) {
    console.error("Fuel API error:", err);
    return NextResponse.json(
      { error: "Unable to fetch fuel prices right now. Please try again shortly." },
      { status: 502 }
    );
  }

  if (!stations || stations.length === 0) {
    return NextResponse.json(
      {
        error: "No fuel stations found nearby. Try a different location.",
        location: geo.display,
        lat: geo.lat,
        lng: geo.lng,
      },
      { status: 404 }
    );
  }

  // Process stations: extract price for selected fuel type, calculate distance
  let results: StationResult[] = stations
    .map((station) => {
      const matchingPrices = station.prices.filter((p) =>
        matchesFuelType(p.fuel_type, fuelType)
      );

      // Pick the cheapest matching fuel price (e.g., E10 over E5)
      const bestPrice =
        matchingPrices.length > 0
          ? matchingPrices.reduce((a, b) => (a.price < b.price ? a : b))
          : null;

      const distance = getDistanceMiles(
        geo.lat,
        geo.lng,
        station.lat,
        station.lng
      );

      return {
        id: station.id,
        name: station.name,
        brand: station.brand,
        address: [station.address, station.postcode].filter(Boolean).join(", "),
        lat: station.lat,
        lng: station.lng,
        price: bestPrice ? bestPrice.price : null,
        fuelType: bestPrice ? bestPrice.fuel_type : fuelType,
        updatedAt: bestPrice?.updated_at || null,
        distanceMiles: Math.round(distance * 10) / 10,
      };
    })
    // Filter out stations without price for selected fuel
    .filter((s) => s.price !== null)
    // Filter by brand if specified
    .filter((s) => {
      if (brand === "all") return true;
      return s.brand.toLowerCase().includes(brand.toLowerCase());
    })
    // Filter to reasonable radius (10 miles)
    .filter((s) => s.distanceMiles !== null && s.distanceMiles <= 10);

  // Sort
  if (sort === "distance") {
    results.sort((a, b) => (a.distanceMiles ?? 99) - (b.distanceMiles ?? 99));
  } else {
    results.sort((a, b) => (a.price ?? 999) - (b.price ?? 999));
  }

  // Limit to top 20
  results = results.slice(0, 20);

  // Find cheapest
  const cheapest = results.length > 0 ? results[0] : null;

  return NextResponse.json({
    location: geo.display,
    lat: geo.lat,
    lng: geo.lng,
    fuelType,
    cheapest: cheapest
      ? {
          name: cheapest.name,
          brand: cheapest.brand,
          price: cheapest.price,
        }
      : null,
    results,
    count: results.length,
    dataUpdated: getDataTimestamp(),
  });
}
