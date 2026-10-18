import { Resvg, initWasm } from "@resvg/resvg-wasm";
import wasmModule from "@resvg/resvg-wasm/index_bg.wasm";
import frauncesFont from "./fonts/Fraunces-Display.ttf";
import outfitFont from "./fonts/Outfit-Medium.ttf";

export interface SharePlace {
  name: string;
  admin1: string;
  country: string;
  latitude: string;
  longitude: string;
}

export interface ShareReading {
  temperatureC: number;
  apparentC: number;
  lowC: number;
  highC: number;
  weatherCode: number;
  isDay: boolean;
  precipProb: number;
}

export interface ShareTags {
  title: string;
  description: string;
  canonical: string;
  metas: Record<string, string>;
}

const DEFAULT_PLACE: SharePlace = {
  name: "New York",
  admin1: "New York",
  country: "United States",
  latitude: "40.71",
  longitude: "-74.01",
};

const CONDITIONS: Record<number, string> = {
  0: "Sunny",
  1: "Mostly sunny",
  2: "Partly sunny",
  3: "Cloudy",
  45: "Fog",
  48: "Rime fog",
  51: "Light drizzle",
  53: "Drizzle",
  55: "Dense drizzle",
  56: "Freezing drizzle",
  57: "Freezing drizzle",
  61: "Light rain",
  63: "Rain",
  65: "Heavy rain",
  66: "Freezing rain",
  67: "Heavy freezing rain",
  71: "Light snow",
  73: "Snow",
  75: "Heavy snow",
  77: "Snow grains",
  80: "Light showers",
  81: "Showers",
  82: "Violent showers",
  85: "Snow showers",
  86: "Heavy snow showers",
  95: "Thunderstorm",
  96: "Thunderstorm with hail",
  99: "Thunderstorm with hail",
};

type SkyName =
  | "idle"
  | "clear-day"
  | "clear-night"
  | "fair-day"
  | "fair-night"
  | "overcast"
  | "fog"
  | "rain"
  | "snow"
  | "storm";

const SKIES: Record<SkyName, { wash: string; glow: string; glow2: string }> = {
  idle: { wash: "#14120e", glow: "#c4a574", glow2: "#7eb8c9" },
  "clear-day": { wash: "#1b140c", glow: "#f0a35a", glow2: "#7eb8c9" },
  "clear-night": { wash: "#0c1020", glow: "#7a86e8", glow2: "#e7c27a" },
  "fair-day": { wash: "#17140f", glow: "#e7b15a", glow2: "#8aa4b5" },
  "fair-night": { wash: "#10131c", glow: "#6674a8", glow2: "#c9b48a" },
  overcast: { wash: "#141618", glow: "#9aa1a6", glow2: "#5e686f" },
  fog: { wash: "#171614", glow: "#c4b8a6", glow2: "#6e6a64" },
  rain: { wash: "#0e1518", glow: "#4ea3b8", glow2: "#d7e4ea" },
  snow: { wash: "#12161c", glow: "#d5e4f2", glow2: "#8fb4d4" },
  storm: { wash: "#130e18", glow: "#b06adf", glow2: "#e08a55" },
};

let wasmReady: Promise<void> | undefined;

export function placeFromParams(params: URLSearchParams): {
  place: SharePlace;
  explicit: boolean;
  needsName: boolean;
} {
  const found = coordsFromParams(params);
  if (!found) {
    return { place: { ...DEFAULT_PLACE }, explicit: false, needsName: false };
  }
  return {
    place: {
      latitude: found.latitude,
      longitude: found.longitude,
      name: "",
      admin1: "",
      country: "",
    },
    explicit: true,
    needsName: true,
  };
}

export function placeQuery(place: SharePlace): string {
  return `l=${place.latitude},${place.longitude}`;
}

export function buildTags(
  origin: string,
  pageUrl: URL,
  place: SharePlace,
  explicit: boolean,
  reading: ShareReading | null,
): ShareTags {
  const name = place.name;
  const image = `${origin}/api/og.png?${imageQuery(place)}`;
  const canonical = explicit ? `${origin}/?${placeQuery(place)}` : `${origin}/`;
  const temps = reading ? pair(reading.temperatureC) : "";
  const title = reading
    ? name
      ? `${temps} in ${name}`
      : temps
    : name
      ? `${name} · Twinweather`
      : "Twinweather";
  const description = reading
    ? `${conditionLine(reading)}. Feels ${pair(reading.apparentC)}.`
    : "Stop juggling between C and F.";
  const alt = reading
    ? `${name ? `${name}, ` : ""}${temps}, ${conditionName(reading.weatherCode, reading.isDay)}`
    : name
      ? `Twinweather — ${name}`
      : "Twinweather — Celsius and Fahrenheit together";
  return {
    title,
    description,
    canonical,
    metas: {
      description,
      "og:title": title,
      "og:description": description,
      "og:url": canonical,
      "og:image": image,
      "og:image:secure_url": image,
      "og:image:type": "image/png",
      "og:image:width": "1200",
      "og:image:height": "630",
      "og:image:alt": alt,
      "twitter:title": title,
      "twitter:description": description,
      "twitter:image": image,
    },
  };
}

export function decorateDocument(shell: Response, tags: ShareTags): Response {
  const rewritten = new HTMLRewriter()
    .on("title", {
      element(element) {
        element.setInnerContent(tags.title);
      },
    })
    .on("meta", {
      element(element) {
        const key = element.getAttribute("property") || element.getAttribute("name");
        if (!key) return;
        const next = tags.metas[key];
        if (next != null) element.setAttribute("content", next);
      },
    })
    .on("link", {
      element(element) {
        if (element.getAttribute("rel") === "canonical") element.setAttribute("href", tags.canonical);
      },
    })
    .transform(shell);
  const headers = new Headers(rewritten.headers);
  headers.set("Content-Type", "text/html; charset=utf-8");
  headers.set("Cache-Control", "public, max-age=300");
  headers.delete("Content-Length");
  return new Response(rewritten.body, { status: rewritten.status, headers });
}

export async function renderCardPng(place: SharePlace, reading: ShareReading | null): Promise<Uint8Array> {
  await startWasm();
  const svg = cardSvg(place, reading);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "original" },
    textRendering: 2,
    font: {
      fontBuffers: [new Uint8Array(outfitFont), new Uint8Array(frauncesFont)],
      defaultFontFamily: "Outfit",
      sansSerifFamily: "Outfit",
      serifFamily: "Fraunces",
    },
  });
  const rendered = resvg.render();
  const png = rendered.asPng().slice();
  rendered.free();
  resvg.free();
  return png;
}

function startWasm(): Promise<void> {
  wasmReady ??= initWasm(wasmModule);
  return wasmReady;
}

function cardSvg(place: SharePlace, reading: ShareReading | null): string {
  const sky = reading ? skyFor(reading.weatherCode, reading.isDay) : "idle";
  const palette = SKIES[sky];
  const name = displayName(place);
  const region = regionLine(place);
  const shift = region ? 0 : 36;
  const city = citySize(name);
  const body = reading ? weatherLines(reading, shift) : fallbackLines(shift);
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="glow" cx="14%" cy="-10%" r="58%">
      <stop offset="0%" stop-color="${palette.glow}" stop-opacity="0.7"/>
      <stop offset="62%" stop-color="${palette.glow}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="glow2" cx="108%" cy="4%" r="52%">
      <stop offset="0%" stop-color="${palette.glow2}" stop-opacity="0.5"/>
      <stop offset="68%" stop-color="${palette.glow2}" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="${palette.wash}"/>
  <rect width="1200" height="630" fill="url(#glow)"/>
  <rect width="1200" height="630" fill="url(#glow2)"/>
  <svg x="562" y="58" width="76" height="76" viewBox="0 0 32 32">
    <defs>
      <clipPath id="mark-l"><rect width="15.25" height="32"/></clipPath>
      <clipPath id="mark-r"><rect x="16.75" width="15.25" height="32"/></clipPath>
    </defs>
    <g fill="none" stroke="#f6f1e8" stroke-width="2.05" stroke-linecap="round">
      <path d="M24.7 16H28.05"/>
      <path d="M22.15 22.15 24.52 24.52"/>
      <path d="M16 24.7V28.05"/>
      <path d="M9.85 22.15 7.48 24.52"/>
      <path d="M7.3 16H3.95"/>
      <path d="M9.85 9.85 7.48 7.48"/>
      <path d="M16 7.3V3.95"/>
      <path d="M22.15 9.85 24.52 7.48"/>
    </g>
    <circle cx="16" cy="16" r="6.55" fill="#8fd0e0" clip-path="url(#mark-l)"/>
    <circle cx="16" cy="16" r="6.55" fill="#f0b56a" clip-path="url(#mark-r)"/>
  </svg>
  <text x="600" y="164" text-anchor="middle" font-family="Outfit" font-size="22" fill="#f6f1e8" fill-opacity="0.88" letter-spacing="0.4">Twinweather</text>
  <text x="600" y="${252 - shift}" text-anchor="middle" font-family="Fraunces" font-size="${city}" fill="#f6f1e8" letter-spacing="${(-city * 0.035).toFixed(2)}">${escapeXml(name)}</text>
  ${region ? `<text x="600" y="${298 - shift}" text-anchor="middle" font-family="Outfit" font-size="22" fill="#f6f1e8" fill-opacity="0.62">${escapeXml(region)}</text>` : ""}
  ${body}
</svg>`;
}

function weatherLines(reading: ShareReading, shift: number): string {
  const c = roundTemp(reading.temperatureC);
  const f = roundTemp(toF(reading.temperatureC));
  const feelsC = roundTemp(reading.apparentC);
  const feelsF = roundTemp(toF(reading.apparentC));
  const low = Math.min(reading.lowC, reading.highC);
  const high = Math.max(reading.lowC, reading.highC);
  const lowC = roundTemp(low);
  const highC = roundTemp(high);
  const lowF = roundTemp(toF(low));
  const highF = roundTemp(toF(high));
  const size = tempSize(`${c}°C | ${f}°F`);
  const unit = Math.round(size * 0.4);
  const raise = Math.round(size * 0.46);
  const pipe = Math.round(size * 0.46);
  const y = 424 - shift;
  return `<text x="600" y="${y}" text-anchor="middle" font-family="Fraunces">
    <tspan font-size="${size}" fill="#e7f7fb">${c}</tspan><tspan font-size="${unit}" fill="#8fd0e0" dy="-${raise}">°C</tspan><tspan dy="${raise}" font-family="Outfit" font-size="${pipe}" fill="#f6f1e8" fill-opacity="0.34">   |   </tspan><tspan font-family="Fraunces" font-size="${size}" fill="#fff4e4">${f}</tspan><tspan font-size="${unit}" fill="#f0b56a" dy="-${raise}">°F</tspan>
  </text>
  <text x="600" y="${y + 58}" text-anchor="middle" font-family="Outfit" font-size="28" fill="#f6f1e8">${escapeXml(conditionLine(reading))}</text>
  <text x="600" y="${y + 100}" text-anchor="middle" font-family="Outfit" font-size="22" fill="#f6f1e8" fill-opacity="0.78">Feels ${feelsC}°C | ${feelsF}°F</text>
  <text x="600" y="${y + 134}" text-anchor="middle" font-family="Outfit" font-size="22" fill="#f6f1e8" fill-opacity="0.55">Today ${lowC}°–${highC}°C | ${lowF}°–${highF}°F</text>`;
}

function fallbackLines(shift: number): string {
  return `<text x="600" y="${430 - shift}" text-anchor="middle" font-family="Outfit" font-size="28" fill="#f6f1e8" fill-opacity="0.8">Stop juggling between C and F.</text>`;
}

function imageQuery(place: SharePlace): string {
  const stamp = new Date().toISOString().slice(0, 13).replace(/[-T]/g, "");
  return `${placeQuery(place)}&t=${stamp}`;
}

function coordsFromParams(params: URLSearchParams): { latitude: string; longitude: string } | null {
  const combined = params.get("l");
  if (combined) {
    const splitAt = combined.indexOf(",");
    if (splitAt > 0) {
      const latitude = coord(combined.slice(0, splitAt), -90, 90);
      const longitude = coord(combined.slice(splitAt + 1), -180, 180);
      if (latitude && longitude) return { latitude, longitude };
    }
  }
  const latitude = coord(params.get("lat"), -90, 90);
  const longitude = coord(params.get("lon"), -180, 180);
  if (latitude && longitude) return { latitude, longitude };
  return null;
}

function regionLine(place: SharePlace): string {
  const same = place.admin1 && place.name && place.admin1.toLowerCase() === place.name.toLowerCase();
  return [same ? "" : place.admin1, place.country].filter(Boolean).join(" · ");
}

function displayName(place: SharePlace): string {
  if (place.name) return place.name;
  return `${place.latitude}°, ${place.longitude}°`;
}

function conditionName(code: number, isDay: boolean): string {
  if (!isDay && code === 0) return "Clear";
  if (!isDay && code === 1) return "Mostly clear";
  if (!isDay && code === 2) return "Partly cloudy";
  return CONDITIONS[code] || "Weather";
}

function conditionLine(reading: ShareReading): string {
  const name = conditionName(reading.weatherCode, reading.isDay);
  const chance = Math.round(reading.precipProb);
  if (chance < 15) return name;
  if (reading.weatherCode >= 51) return `${name} · ${chance}%`;
  return `${name} · ${chance}% chance`;
}

function skyFor(code: number, isDay: boolean): SkyName {
  if (code === 0) return isDay ? "clear-day" : "clear-night";
  if (code === 1 || code === 2) return isDay ? "fair-day" : "fair-night";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "overcast";
}

function pair(celsius: number): string {
  return `${roundTemp(celsius)}°C | ${roundTemp(toF(celsius))}°F`;
}

function citySize(name: string): number {
  const length = [...name].length;
  let size = length <= 11 ? 76 : length <= 16 ? 62 : length <= 22 ? 50 : 40;
  while (length * size * 0.52 > 640 && size > 32) size -= 2;
  return size;
}

function tempSize(sample: string): number {
  let size = 96;
  while (sample.length * size * 0.5 > 700 && size > 68) size -= 4;
  return size;
}

function roundTemp(value: number): number {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function toF(celsius: number): number {
  return (celsius * 9) / 5 + 32;
}

function coord(raw: string | null, min: number, max: number): string | null {
  if (raw == null || !raw.trim()) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value.toFixed(2);
}

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}
