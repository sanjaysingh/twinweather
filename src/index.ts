interface GeocodeHit {
  id: number;
  name: string;
  latitude: number;
  longitude: number;
  country: string;
  admin1?: string;
  timezone?: string;
}

interface ForecastPayload {
  timezone: string;
  current: {
    time: string;
    temperatureC: number;
    apparentC: number;
    humidity: number;
    precipitation: number;
    weatherCode: number;
    isDay: boolean;
    windKmh: number;
    windDeg: number;
  };
  hourly: Array<{
    time: string;
    temperatureC: number;
    precipProb: number;
    weatherCode: number;
    isDay: boolean;
  }>;
  daily: Array<{
    date: string;
    weatherCode: number;
    maxC: number;
    minC: number;
    precipProb: number;
    windMinKmh: number;
    windMaxKmh: number;
    windDeg: number;
    sunrise: string;
    sunset: string;
    uv: number | null;
  }>;
}

const UPSTREAM_HEADERS = {
  Accept: "application/json",
  "User-Agent": "Twinweather/1.0 (https://twinweather.sanjaysingh.net)",
};

export default {
  async fetch(request): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== "GET") {
      return json({ error: "Method not allowed." }, 405);
    }

    try {
      if (url.pathname === "/api/geocode") return await geocode(url);
      if (url.pathname === "/api/reverse") return await reverse(url);
      if (url.pathname === "/api/forecast") return await forecast(url);
      return json({ error: "Not found." }, 404);
    } catch (error) {
      console.log(
        JSON.stringify({
          level: "error",
          event: "request_failed",
          path: url.pathname,
          message: error instanceof Error ? error.message : "unknown",
        }),
      );
      return json({ error: "Weather service is unavailable." }, 502);
    }
  },
} satisfies ExportedHandler;

async function geocode(url: URL): Promise<Response> {
  const query = cleanQuery(url.searchParams.get("q"));
  if (!query) return json({ error: "Enter at least 2 characters." }, 400);

  const upstream = new URL("https://geocoding-api.open-meteo.com/v1/search");
  upstream.searchParams.set("name", query);
  upstream.searchParams.set("count", "6");
  upstream.searchParams.set("language", "en");
  upstream.searchParams.set("format", "json");

  const payload = await readJson(upstream, UPSTREAM_HEADERS);
  const results = Array.isArray(payload.results) ? payload.results.flatMap(asPlace) : [];
  // Place names are stable. Keep a hit warm for a day, then refresh it in the background.
  return json({ results }, 200, results.length > 0 ? 86_400 : 60, results.length > 0 ? 86_400 : 0);
}

async function reverse(url: URL): Promise<Response> {
  const latitude = coordinate(url.searchParams.get("latitude"), -90, 90);
  const longitude = coordinate(url.searchParams.get("longitude"), -180, 180);
  if (latitude == null || longitude == null) {
    return json({ error: "A valid location is required." }, 400);
  }

  const upstream = new URL("https://nominatim.openstreetmap.org/reverse");
  upstream.searchParams.set("lat", latitude);
  upstream.searchParams.set("lon", longitude);
  upstream.searchParams.set("format", "jsonv2");
  upstream.searchParams.set("addressdetails", "1");
  upstream.searchParams.set("accept-language", "en");
  upstream.searchParams.set("zoom", "12");

  const payload = await readJson(upstream, {
    "User-Agent": "Twinweather/1.0 (https://twinweather.sanjaysingh.net)",
    Accept: "application/json",
  });
  const address = asRecord(payload.address);
  const name = address
    ? asString(address.city) ||
      asString(address.town) ||
      asString(address.village) ||
      asString(address.municipality) ||
      asString(address.hamlet) ||
      asString(address.suburb) ||
      asString(address.county)
    : null;
  if (!name) return json({ result: null }, 200, 3600);

  const admin1 = asString(address?.state);
  return json(
    {
      result: {
        id: 0,
        name,
        latitude: Number(latitude),
        longitude: Number(longitude),
        country: asString(address?.country) || "",
        ...(admin1 ? { admin1 } : {}),
      },
    },
    200,
    86_400,
    86_400,
  );
}

async function forecast(url: URL): Promise<Response> {
  const latitude = coordinate(url.searchParams.get("latitude"), -90, 90);
  const longitude = coordinate(url.searchParams.get("longitude"), -180, 180);
  if (latitude == null || longitude == null) {
    return json({ error: "A valid location is required." }, 400);
  }

  const upstream = new URL("https://api.open-meteo.com/v1/forecast");
  upstream.searchParams.set("latitude", latitude);
  upstream.searchParams.set("longitude", longitude);
  upstream.searchParams.set(
    "current",
    [
      "temperature_2m",
      "relative_humidity_2m",
      "apparent_temperature",
      "is_day",
      "precipitation",
      "weather_code",
      "wind_speed_10m",
      "wind_direction_10m",
    ].join(","),
  );
  upstream.searchParams.set(
    "hourly",
    ["temperature_2m", "precipitation", "precipitation_probability", "weather_code", "is_day"].join(","),
  );
  upstream.searchParams.set(
    "daily",
    [
      "weather_code",
      "temperature_2m_max",
      "temperature_2m_min",
      "precipitation_probability_max",
      "wind_speed_10m_min",
      "wind_speed_10m_max",
      "wind_direction_10m_dominant",
      "sunrise",
      "sunset",
      "uv_index_max",
    ].join(","),
  );
  upstream.searchParams.set("timezone", "auto");
  upstream.searchParams.set("forecast_days", "7");
  upstream.searchParams.set("temperature_unit", "celsius");
  upstream.searchParams.set("wind_speed_unit", "kmh");

  const payload = await readJson(upstream, UPSTREAM_HEADERS);
  const shaped = shapeForecast(payload);
  if (!shaped) throw new Error("forecast payload missing required fields");
  // User actions (open / locate / search) bust the URL; keep the edge from
  // holding a shared forecast that can outlive the weather outside.
  return json(shaped, 200);
}

function shapeForecast(payload: Record<string, unknown>): ForecastPayload | null {
  const current = asRecord(payload.current);
  const hourly = asRecord(payload.hourly);
  const daily = asRecord(payload.daily);
  if (!current || !hourly || !daily) return null;

  const temperatureC = asNumber(current.temperature_2m);
  const apparentC = asNumber(current.apparent_temperature);
  const humidity = asNumber(current.relative_humidity_2m);
  const precipitation = asNumber(current.precipitation);
  const weatherCode = asNumber(current.weather_code);
  const windKmh = asNumber(current.wind_speed_10m);
  const windDeg = asNumber(current.wind_direction_10m);
  const time = asString(current.time);
  if (
    temperatureC == null ||
    apparentC == null ||
    humidity == null ||
    precipitation == null ||
    weatherCode == null ||
    windKmh == null ||
    windDeg == null ||
    !time
  ) {
    return null;
  }

  const hourlyTimes = asArray(hourly.time);
  const hourlyTemps = asArray(hourly.temperature_2m);
  const hourlyAmount = asArray(hourly.precipitation);
  const hourlyPrecip = asArray(hourly.precipitation_probability);
  const hourlyCodes = asArray(hourly.weather_code);
  const hourlyDay = asArray(hourly.is_day);
  const hourCount = Math.min(
    hourlyTimes.length,
    hourlyTemps.length,
    hourlyPrecip.length,
    hourlyCodes.length,
    hourlyDay.length,
  );
  const currentHour = time.slice(0, 13);
  const hours: ForecastPayload["hourly"] = [];
  for (let i = 0; i < hourCount; i++) {
    const hourTime = asString(hourlyTimes[i]);
    const hourTemp = asNumber(hourlyTemps[i]);
    const hourProb = asNumber(hourlyPrecip[i]);
    const hourCode = asNumber(hourlyCodes[i]);
    const hourDay = asNumber(hourlyDay[i]);
    if (!hourTime || hourTemp == null || hourProb == null || hourCode == null || hourDay == null) continue;
    hours.push({
      time: hourTime,
      temperatureC: hourTemp,
      precipProb: hourProb,
      weatherCode: hourCode,
      isDay: hourDay === 1,
    });
  }

  const dates = asArray(daily.time);
  const codes = asArray(daily.weather_code);
  const maxes = asArray(daily.temperature_2m_max);
  const mins = asArray(daily.temperature_2m_min);
  const probs = asArray(daily.precipitation_probability_max);
  const windMins = asArray(daily.wind_speed_10m_min);
  const windMaxes = asArray(daily.wind_speed_10m_max);
  const windDirs = asArray(daily.wind_direction_10m_dominant);
  const sunrises = asArray(daily.sunrise);
  const sunsets = asArray(daily.sunset);
  const uvs = asArray(daily.uv_index_max);
  const dayCount = Math.min(
    dates.length,
    codes.length,
    maxes.length,
    mins.length,
    probs.length,
    windMins.length,
    windMaxes.length,
    windDirs.length,
    sunrises.length,
    sunsets.length,
  );

  // The day's icon and rain chance use only the hours from sunrise through
  // the last hour before sunset. Rain before sunrise or after sunset stays
  // on the hourly row and does not change that day's summary.
  const sunWindow = new Map<string, { sunrise: string; sunset: string }>();
  for (let i = 0; i < dayCount; i++) {
    const date = asString(dates[i]);
    const sunrise = asString(sunrises[i]);
    const sunset = asString(sunsets[i]);
    if (date && sunrise && sunset) sunWindow.set(date, { sunrise, sunset });
  }

  const daylightHours = new Map<string, SunHour[]>();
  for (let i = 0; i < hourCount; i++) {
    const hourTime = asString(hourlyTimes[i]);
    const hourCode = asNumber(hourlyCodes[i]);
    const hourProb = asNumber(hourlyPrecip[i]);
    if (!hourTime || hourCode == null || hourProb == null) continue;
    if (!inSunWindow(hourTime, sunWindow.get(hourTime.slice(0, 10)))) continue;
    const date = hourTime.slice(0, 10);
    const sample = { code: hourCode, precipProb: hourProb, precipMm: asNumber(hourlyAmount[i]) ?? 0 };
    const list = daylightHours.get(date);
    if (list) list.push(sample);
    else daylightHours.set(date, [sample]);
  }

  const days: ForecastPayload["daily"] = [];
  for (let i = 0; i < dayCount && days.length < 7; i++) {
    const date = asString(dates[i]);
    const code = asNumber(codes[i]);
    const maxC = asNumber(maxes[i]);
    const minC = asNumber(mins[i]);
    const precipProb = asNumber(probs[i]);
    const windMinKmh = asNumber(windMins[i]);
    const windMaxKmh = asNumber(windMaxes[i]);
    const windDeg = asNumber(windDirs[i]);
    const sunrise = asString(sunrises[i]);
    const sunset = asString(sunsets[i]);
    if (
      !date ||
      code == null ||
      maxC == null ||
      minC == null ||
      precipProb == null ||
      windMinKmh == null ||
      windMaxKmh == null ||
      windDeg == null ||
      !sunrise ||
      !sunset
    ) {
      continue;
    }
    const summary = summarizeDaylight(daylightHours.get(date) ?? []);
    days.push({
      date,
      weatherCode: summary?.weatherCode ?? code,
      maxC,
      minC,
      // A day with sunrise-to-sunset hours must not inherit the overnight chance.
      precipProb: summary?.precipProb ?? precipProb,
      windMinKmh,
      windMaxKmh,
      windDeg,
      sunrise,
      sunset,
      uv: asNumber(uvs[i]),
    });
  }

  if (hours.length === 0 || days.length === 0) return null;

  // Instantaneous current weather_code can lag a rainy hour (e.g. drizzle
  // while the current hour is rain). Prefer the wetter of the two.
  const currentSlot = hours.find((hour) => hour.time.slice(0, 13) >= currentHour) ?? hours[0];
  const hourCode = currentSlot?.weatherCode ?? null;
  const displayCode = preferCurrentWeatherCode(weatherCode, hourCode, precipitation);

  return {
    timezone: asString(payload.timezone) || "UTC",
    current: {
      time,
      temperatureC,
      apparentC,
      humidity,
      precipitation,
      weatherCode: displayCode,
      isDay: current.is_day === 1,
      windKmh,
      windDeg,
    },
    hourly: hours,
    daily: days,
  };
}

async function readJson(upstream: URL, headers: HeadersInit): Promise<Record<string, unknown>> {
  const response = await fetch(upstream, {
    headers,
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) {
    const detail = (await response.text()).slice(0, 180);
    console.log(
      JSON.stringify({
        level: "error",
        event: "upstream",
        status: response.status,
        host: upstream.host,
        detail,
      }),
    );
    throw new Error(`upstream ${response.status}`);
  }
  const payload: unknown = await response.json();
  const record = asRecord(payload);
  if (!record) throw new Error("upstream JSON was not an object");
  return record;
}

function asPlace(value: unknown): GeocodeHit[] {
  const record = asRecord(value);
  if (!record) return [];
  const id = asNumber(record.id);
  const name = asString(record.name);
  const latitude = asNumber(record.latitude);
  const longitude = asNumber(record.longitude);
  const country = asString(record.country);
  if (id == null || !name || latitude == null || longitude == null || !country) return [];
  const admin1 = asString(record.admin1);
  const timezone = asString(record.timezone);
  return [
    {
      id,
      name,
      latitude,
      longitude,
      country,
      ...(admin1 ? { admin1 } : {}),
      ...(timezone ? { timezone } : {}),
    },
  ];
}

function json(data: unknown, status = 200, cacheSeconds = 0, staleSeconds = 0): Response {
  let cacheControl = "no-store";
  if (cacheSeconds > 0) {
    cacheControl = `public, max-age=${cacheSeconds}`;
    if (staleSeconds > 0) {
      cacheControl += `, stale-while-revalidate=${staleSeconds}, stale-if-error=${staleSeconds}`;
    }
  }
  const headers = new Headers({
    "Content-Type": "application/json; charset=utf-8",
    "X-Content-Type-Options": "nosniff",
    "Cache-Control": cacheControl,
  });
  return new Response(JSON.stringify(data), { status, headers });
}

function cleanQuery(raw: string | null): string | null {
  if (!raw) return null;
  const query = raw.trim().replace(/\s+/g, " ");
  if (query.length < 2 || query.length > 80) return null;
  if (/[\u0000-\u001F\u007F]/.test(query)) return null;
  return query;
}

function coordinate(raw: string | null, min: number, max: number): string | null {
  if (raw == null) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value < min || value > max) return null;
  return value.toFixed(2);
}

/** True when this hour's timestamp falls from sunrise up to, but not including, sunset. */
function inSunWindow(time: string, window: { sunrise: string; sunset: string } | undefined): boolean {
  if (!window) return false;
  return time >= window.sunrise && time < window.sunset;
}

interface SunHour {
  code: number;
  precipProb: number;
  precipMm: number;
}

/** Same bar the page uses before it prints a rain chance next to a dry sky. */
const MENTION_CHANCE = 15;

/**
 * The day's sky is whatever covers the most hours between sunrise and sunset.
 * Precipitation replaces that sky when it is the most common condition, or
 * when its chance is at least 15%. A 2% drizzle hour does not rename a sunny day.
 * Dry days only carry POP from actual wet hours, so clear-sky model odds do not
 * become a sunny-day rain percentage.
 */
function summarizeDaylight(hours: SunHour[]): { weatherCode: number; precipProb: number } | null {
  if (hours.length === 0) return null;

  const wet = hours.filter((hour) => hour.code >= 51 && hour.precipProb > 0);
  const sky = hours.filter((hour) => hour.code < 51);
  const skyCode = daytimeWeatherCode(sky.map((hour) => hour.code));
  const wetPop = wet.length > 0 ? Math.max(...wet.map((hour) => hour.precipProb)) : 0;
  const wetSummary = wet.length > 0 ? mainPrecipitation(wet) : null;
  const wetDominates = wetSummary != null && wet.length > mostCommonCount(sky.map((hour) => hour.code));
  if (wetSummary && (wetDominates || wetSummary.precipProb >= MENTION_CHANCE)) return wetSummary;
  if (skyCode == null) return wetSummary ?? { weatherCode: hours[0]!.code, precipProb: wetPop };
  return { weatherCode: skyCode, precipProb: wetPop };
}

/** Precipitation type with the most daylight water, and that type's highest chance. */
function mainPrecipitation(hours: SunHour[]): { weatherCode: number; precipProb: number } {
  const groups = new Map<number, { mm: number; count: number; pop: number }>();
  for (const hour of hours) {
    const group = groups.get(hour.code) ?? { mm: 0, count: 0, pop: 0 };
    group.mm += Math.max(0, hour.precipMm);
    group.count += 1;
    group.pop = Math.max(group.pop, hour.precipProb);
    groups.set(hour.code, group);
  }

  const hasWater = [...groups.values()].some((group) => group.mm > 0);
  let bestCode = hours[0]!.code;
  let best = groups.get(bestCode)!;
  for (const [code, group] of groups) {
    const better = hasWater
      ? group.mm > best.mm || (group.mm === best.mm && (group.count > best.count || (group.count === best.count && code > bestCode)))
      : group.pop > best.pop || (group.pop === best.pop && (group.count > best.count || (group.count === best.count && code > bestCode)));
    if (better) {
      bestCode = code;
      best = group;
    }
  }
  return { weatherCode: bestCode, precipProb: best.pop };
}

function mostCommonCount(codes: number[]): number {
  const counts = new Map<number, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);
  return Math.max(0, ...counts.values());
}

function isPrecipCode(code: number): boolean {
  return (code >= 51 && code <= 67) || (code >= 80 && code <= 82) || code >= 95;
}

/** Prefer a rainy hourly code when instantaneous current understates wet weather. */
function preferCurrentWeatherCode(current: number, hour: number | null, precipitation: number): number {
  if (hour != null && isPrecipCode(hour) && (!isPrecipCode(current) || hour > current)) {
    return hour;
  }
  if (precipitation > 0 && !isPrecipCode(current)) return 51;
  return current;
}

/** Most common sky code between sunrise and sunset. Ties go to the clearer code. */
function daytimeWeatherCode(codes: number[]): number | null {
  if (codes.length === 0) return null;

  const counts = new Map<number, number>();
  for (const code of codes) counts.set(code, (counts.get(code) ?? 0) + 1);

  let best = codes[0]!;
  let bestCount = 0;
  for (const [code, count] of counts) {
    if (count > bestCount || (count === bestCount && code < best)) {
      best = code;
      bestCount = count;
    }
  }
  return best;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value == null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
