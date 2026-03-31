// Uses postcodes.io (free, no API key) for UK postcode/place geocoding

export interface GeoResult {
  lat: number;
  lng: number;
  display: string;
}

export async function geocodeLocation(query: string): Promise<GeoResult | null> {
  const trimmed = query.trim();

  // Try as postcode first (UK postcodes match this loosely)
  const postcodeRes = await fetch(
    `https://api.postcodes.io/postcodes/${encodeURIComponent(trimmed)}`
  );

  if (postcodeRes.ok) {
    const data = await postcodeRes.json();
    if (data.status === 200 && data.result) {
      return {
        lat: data.result.latitude,
        lng: data.result.longitude,
        display: data.result.postcode,
      };
    }
  }

  // Try as place name via postcodes.io places endpoint
  const placesRes = await fetch(
    `https://api.postcodes.io/places?q=${encodeURIComponent(trimmed)}&limit=1`
  );

  if (placesRes.ok) {
    const data = await placesRes.json();
    if (data.status === 200 && data.result && data.result.length > 0) {
      const place = data.result[0];
      return {
        lat: place.latitude,
        lng: place.longitude,
        display: place.name_1,
      };
    }
  }

  return null;
}
