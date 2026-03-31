"use client";

import { StationResult } from "@/lib/fuel-api";

export function StationCard({
  station,
  isCheapest,
}: {
  station: StationResult;
  isCheapest: boolean;
}) {
  const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${station.name} ${station.address}`
  )}`;

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    station.address || `${station.lat},${station.lng}`
  )}`;

  return (
    <div
      className={`relative rounded-lg border p-4 transition-shadow hover:shadow-md ${
        isCheapest
          ? "border-green-400 bg-green-50 shadow-sm"
          : "border-gray-200 bg-white"
      }`}
    >
      {isCheapest && (
        <span className="absolute -top-2.5 left-3 rounded-full bg-green-500 px-2.5 py-0.5 text-xs font-semibold text-white">
          Cheapest nearby
        </span>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">{station.name}</h3>
          <p className="text-sm text-gray-500">{station.brand}</p>
          {station.address && (
            <p className="mt-1 text-sm text-gray-600 truncate">{station.address}</p>
          )}
          <div className="mt-2 flex items-center gap-3 text-xs text-gray-400">
            {station.distanceMiles !== null && (
              <span>{station.distanceMiles} miles away</span>
            )}
            {station.updatedAt && (
              <span>
                Updated{" "}
                {new Date(station.updatedAt).toLocaleDateString("en-GB", {
                  day: "numeric",
                  month: "short",
                })}
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-col items-end gap-2 shrink-0">
          <div className="text-right">
            <span className="text-2xl font-bold text-gray-900">
              {station.price !== null ? `${station.price.toFixed(1)}p` : "N/A"}
            </span>
            <span className="block text-xs text-gray-400">per litre</span>
          </div>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <a
          href={directionsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 transition-colors"
        >
          <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 6.75V15m6-6v8.25m.503 3.498 4.875-2.437c.381-.19.622-.58.622-1.006V4.82c0-.836-.88-1.38-1.628-1.006l-3.869 1.934c-.317.159-.69.159-1.006 0L9.503 3.252a1.125 1.125 0 0 0-1.006 0L3.622 5.689C3.24 5.88 3 6.27 3 6.695V19.18c0 .836.88 1.38 1.628 1.006l3.869-1.934c.317-.159.69-.159 1.006 0l4.994 2.497c.317.158.69.158 1.006 0Z" />
          </svg>
          Get directions
        </a>
        <a
          href={mapsUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50 transition-colors"
        >
          View on map
        </a>
      </div>
    </div>
  );
}
