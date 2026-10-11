"use strict";

const QUICK = [
  { name: "New York", admin1: "New York", country: "United States", latitude: 40.71, longitude: -74.01 },
  { name: "London", admin1: "England", country: "United Kingdom", latitude: 51.51, longitude: -0.13 },
  { name: "Tokyo", admin1: "Tokyo", country: "Japan", latitude: 35.68, longitude: 139.69 },
  { name: "Lisbon", admin1: "Lisbon", country: "Portugal", latitude: 38.72, longitude: -9.14 },
  { name: "Mexico City", admin1: "Mexico City", country: "Mexico", latitude: 19.43, longitude: -99.13 },
  { name: "Reykjavík", admin1: null, country: "Iceland", latitude: 64.15, longitude: -21.94 },
];

const CONDITIONS = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
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

const FORECAST_KEY = "twinweather-forecasts";
const STALE_MS = 10 * 60 * 1000;
const FORECAST_TIMEOUT_MS = 20000;

const $ = (id) => document.getElementById(id);

const state = {
  place: null,
  clock: 0,
  searchAbort: null,
  forecastAbort: null,
  activeSuggest: -1,
  fetchedAt: 0,
  refreshId: 0,
  refreshing: false,
  locating: false,
  hasForecast: false,
};

const chips = $("chips");
for (const place of QUICK) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "chip";
  button.textContent = place.name;
  button.setAttribute("aria-pressed", "false");
  button.addEventListener("click", () => {
    closeSearch();
    selectPlace(place);
  });
  chips.append(button);
}

$("finder").addEventListener("submit", (event) => {
  event.preventDefault();
  const first = $("suggest").querySelector("button");
  if (first) first.click();
});

$("q").addEventListener("input", () => {
  const query = $("q").value.trim();
  state.activeSuggest = -1;
  if (query.length < 2) {
    closeSuggest();
    return;
  }
  window.clearTimeout(state.searchTimer);
  state.searchTimer = window.setTimeout(() => runSearch(query), 280);
});

$("q").addEventListener("keydown", (event) => {
  const buttons = [...$("suggest").querySelectorAll("button")];
  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    if (buttons.length === 0) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    state.activeSuggest = (state.activeSuggest + delta + buttons.length) % buttons.length;
    buttons.forEach((button, index) => {
      button.setAttribute("aria-selected", index === state.activeSuggest ? "true" : "false");
    });
    buttons[state.activeSuggest].scrollIntoView({ block: "nearest" });
  } else if (event.key === "Enter" && state.activeSuggest >= 0) {
    event.preventDefault();
    buttons[state.activeSuggest]?.click();
  } else if (event.key === "Escape") {
    closeSearch();
  }
});

$("open-search").addEventListener("click", openSearch);
$("overlay").addEventListener("click", (event) => {
  if (event.target.closest("[data-close]")) closeSearch();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !$("overlay").hidden) closeSearch();
});

$("locate").addEventListener("click", locate);

watchForReturn();
boot();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

async function boot() {
  const saved = readSaved();
  if (saved) {
    await selectPlace(saved, { remember: false });
    return;
  }
  let granted = false;
  try {
    const permission = await navigator.permissions.query({ name: "geolocation" });
    granted = permission.state === "granted";
  } catch {
    granted = false;
  }
  if (granted) {
    locate();
    return;
  }
  await selectPlace(QUICK[0]);
}

async function runSearch(query) {
  state.searchAbort?.abort();
  state.searchAbort = new AbortController();
  try {
    const response = await fetch(`/api/geocode?q=${encodeURIComponent(query)}`, {
      signal: state.searchAbort.signal,
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error || "Search failed");
    renderSuggest(payload.results || []);
  } catch (error) {
    if (error.name === "AbortError") return;
    closeSuggest();
    setStatus("Place search didn't respond. Try again.");
  }
}

function renderSuggest(results) {
  const list = $("suggest");
  list.replaceChildren();
  if (results.length === 0) {
    const item = document.createElement("li");
    const note = document.createElement("button");
    note.type = "button";
    note.disabled = true;
    note.textContent = "No places match that.";
    item.append(note);
    list.append(item);
    list.hidden = false;
    $("chips").hidden = true;
    $("q").setAttribute("aria-expanded", "true");
    return;
  }
  for (const place of results) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("role", "option");
    button.setAttribute("aria-selected", "false");
    const title = document.createElement("span");
    title.textContent = place.name;
    const meta = document.createElement("small");
    meta.textContent = [place.admin1, place.country].filter(Boolean).join(" · ");
    button.append(title, meta);
    button.addEventListener("click", () => {
      closeSearch();
      selectPlace(place);
    });
    item.append(button);
    list.append(item);
  }
  list.hidden = false;
  $("chips").hidden = true;
  $("q").setAttribute("aria-expanded", "true");
}

function openSearch() {
  $("overlay").hidden = false;
  $("open-search").setAttribute("aria-expanded", "true");
  document.body.classList.add("is-searching");
  $("q").focus();
}

function closeSearch() {
  const wasOpen = !$("overlay").hidden;
  $("overlay").hidden = true;
  $("open-search").setAttribute("aria-expanded", "false");
  document.body.classList.remove("is-searching");
  $("q").value = "";
  closeSuggest();
  if (wasOpen) $("open-search").focus();
}

function closeSuggest() {
  $("suggest").hidden = true;
  $("suggest").replaceChildren();
  $("chips").hidden = false;
  $("q").setAttribute("aria-expanded", "false");
  state.activeSuggest = -1;
}

function locate() {
  if (!navigator.geolocation) {
    setStatus("This browser can't share a location. Search for a city instead.");
    return;
  }
  const locateId = ++state.refreshId;
  state.locating = true;
  state.forecastAbort?.abort();
  setRefreshing(true, "Finding your location…");
  navigator.geolocation.getCurrentPosition(
    async (position) => {
      if (locateId !== state.refreshId) return;
      const latitude = roundCoord(position.coords.latitude);
      const longitude = roundCoord(position.coords.longitude);
      try {
        const response = await fetch(`/api/reverse?latitude=${latitude}&longitude=${longitude}`);
        const payload = await response.json();
        if (locateId !== state.refreshId) return;
        const place = payload.result || {
          name: "Current location",
          admin1: null,
          country: "",
          latitude: Number(latitude),
          longitude: Number(longitude),
        };
        state.locating = false;
        await selectPlace({ ...place, latitude: Number(latitude), longitude: Number(longitude) });
      } catch {
        if (locateId !== state.refreshId) return;
        state.locating = false;
        setRefreshing(false);
        setStatus("Location found, but the place name didn't load. Try again.");
      }
    },
    () => {
      if (locateId !== state.refreshId) return;
      state.locating = false;
      setRefreshing(false);
      setStatus("Location permission was blocked. Search for a city instead.");
    },
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 },
  );
}

async function selectPlace(place, { remember = true } = {}) {
  const next = normalizePlace(place);
  const previousKey = state.place ? placeKey(state.place) : "";
  const alreadyShowing = previousKey === placeKey(next) && state.hasForecast;
  state.locating = false;
  state.place = next;
  if (remember) localStorage.setItem("twinweather-place", JSON.stringify(state.place));
  markChip(state.place);

  // Keep the last reading on screen, then ask for a new one. The page stays usable.
  const cached = readCachedForecast(next);
  if (!alreadyShowing && cached) {
    try {
      render(state.place, cached.forecast);
      state.fetchedAt = Number(cached.savedAt) || 0;
    } catch {
      showPendingPlace(next);
      state.fetchedAt = 0;
    }
  } else if (!alreadyShowing) {
    showPendingPlace(next);
    state.fetchedAt = 0;
  }

  const refreshId = ++state.refreshId;
  const label = state.hasForecast ? "Refreshing weather…" : "Loading weather…";
  setRefreshing(true, label);
  state.forecastAbort?.abort();
  const abort = new AbortController();
  state.forecastAbort = abort;
  const timer = window.setTimeout(() => abort.abort(), FORECAST_TIMEOUT_MS);
  try {
    const response = await fetch(
      `/api/forecast?latitude=${state.place.latitude.toFixed(2)}&longitude=${state.place.longitude.toFixed(2)}`,
      { signal: abort.signal, cache: "no-cache" },
    );
    const payload = await response.json();
    if (refreshId !== state.refreshId) return;
    if (!response.ok || !isUsableForecast(payload)) throw new Error(payload.error || "Forecast failed");
    render(state.place, payload);
    state.fetchedAt = Date.now();
    writeCachedForecast(state.place, payload);
    setStatus("");
  } catch (error) {
    if (refreshId !== state.refreshId) return;
    if (error.name === "AbortError" && abort !== state.forecastAbort) return;
    setStatus(
      state.hasForecast
        ? "Couldn't refresh. Still showing the last weather."
        : "The forecast didn't come through. Check your connection and try again.",
    );
  } finally {
    window.clearTimeout(timer);
    if (refreshId === state.refreshId && !state.locating) setRefreshing(false);
  }
}

function render(place, forecast) {
  const today = forecast.daily[0];
  const sky = skyFor(forecast.current.weatherCode, forecast.current.isDay);
  document.body.dataset.sky = sky;
  $("condition-icon").innerHTML = icon(forecast.current.weatherCode, forecast.current.isDay);
  $("condition-label").textContent = CONDITIONS[forecast.current.weatherCode] || "Weather";
  $("place-name").textContent = place.name;
  $("place-region").textContent = [place.admin1, place.country].filter(Boolean).join(" · ");
  startClock(forecast.timezone);

  setPair("c-now", "f-now", forecast.current.temperatureC);
  setPair("c-feels", "f-feels", forecast.current.apparentC);
  if (today) {
    setPair("c-low", "f-low", today.minC);
    setPair("c-high", "f-high", today.maxC);
    const rise = clock(today.sunrise);
    const set = clock(today.sunset);
    $("sun-times").textContent = `${rise} – ${set}`;
    $("sunline").hidden = false;
    $("sunline").setAttribute("aria-label", `Sunrise ${rise}, sunset ${set}`);
    $("uv").textContent = today.uv == null ? "—" : String(Math.round(today.uv));
  }

  $("humidity").textContent = `${Math.round(forecast.current.humidity)}%`;
  $("wind").replaceChildren();
  const direction = document.createElement("span");
  direction.className = "wind-dir";
  direction.textContent = compass(forecast.current.windDeg);
  const speeds = document.createElement("span");
  speeds.className = "pair";
  const kilo = document.createElement("span");
  kilo.className = "c";
  kilo.textContent = `${Math.round(forecast.current.windKmh)} km/h`;
  const miles = document.createElement("span");
  miles.className = "f";
  miles.textContent = `${Math.round(forecast.current.windKmh * 0.621371)} mph`;
  speeds.append(kilo, miles);
  $("wind").append(direction, speeds);

  const currentHour = forecast.hourly[0];
  $("rain").textContent = currentHour ? `${Math.round(currentHour.precipProb)}%` : "—";

  renderHours(forecast);
  renderDays(forecast);
  const c = roundTemp(forecast.current.temperatureC);
  const f = roundTemp(toF(forecast.current.temperatureC));
  document.title = `${c}°C | ${f}°F ${place.name}`;
  state.hasForecast = true;
}

function renderHours(forecast) {
  const row = $("hours");
  row.replaceChildren();
  const nowHour = forecast.current.time.slice(0, 13);
  for (const hour of forecast.hourly) {
    const cell = document.createElement("article");
    cell.className = hour.time.slice(0, 13) === nowHour ? "hour is-now" : "hour";
    const time = document.createElement("time");
    time.dateTime = hour.time;
    time.textContent = hour.time.slice(0, 13) === nowHour ? "Now" : clock(hour.time);
    const sky = document.createElement("span");
    sky.innerHTML = icon(hour.weatherCode, hour.isDay);
    cell.append(time, sky, pair(hour.temperatureC));
    if (hour.precipProb >= 15) {
      const pop = document.createElement("span");
      pop.className = "pop";
      pop.textContent = `${Math.round(hour.precipProb)}%`;
      cell.append(pop);
    }
    row.append(cell);
  }
}

function renderDays(forecast) {
  const list = $("days");
  list.replaceChildren();
  const todayKey = localDate(forecast.timezone);
  forecast.daily.forEach((day, index) => {
    const item = document.createElement("li");
    item.className = "day";
    const name = document.createElement("span");
    name.className = "day-name";
    name.textContent = index === 0 || day.date === todayKey ? "Today" : index === 1 ? "Tomorrow" : weekday(day.date);
    const sky = document.createElement("span");
    sky.className = "day-sky";
    sky.innerHTML = icon(day.weatherCode, true);
    const note = document.createElement("span");
    note.className = "day-note";
    const label = CONDITIONS[day.weatherCode] || "Weather";
    note.textContent = day.precipProb > 0 ? `${label} · ${Math.round(day.precipProb)}%` : label;
    const low = pair(day.minC);
    const high = pair(day.maxC);
    item.append(name, sky, note, low, high);
    list.append(item);
  });
}

function pair(celsius) {
  const node = document.createElement("span");
  node.className = "pair";
  const c = document.createElement("span");
  c.className = "c";
  c.textContent = `${roundTemp(celsius)}°C`;
  const f = document.createElement("span");
  f.className = "f";
  f.textContent = `${roundTemp(toF(celsius))}°F`;
  node.append(c, f);
  return node;
}

function setPair(celsiusId, fahrenheitId, celsius) {
  $(celsiusId).textContent = String(roundTemp(celsius));
  $(fahrenheitId).textContent = String(roundTemp(toF(celsius)));
}

function toF(celsius) {
  return (celsius * 9) / 5 + 32;
}

function roundTemp(value) {
  const rounded = Math.round(value);
  return Object.is(rounded, -0) ? 0 : rounded;
}

function roundCoord(value) {
  return (Math.round(Number(value) * 100) / 100).toFixed(2);
}

function clock(iso) {
  const time = iso.split("T")[1];
  if (!time) return "";
  const [hourText, minute] = time.split(":");
  const hour = Number(hourText);
  const suffix = hour >= 12 ? "pm" : "am";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minute} ${suffix}`;
}

function weekday(date) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

function localDate(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function startClock(timeZone) {
  window.clearInterval(state.clock);
  const tick = () => {
    $("local-time").textContent = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date());
    $("local-time").dateTime = new Date().toISOString();
  };
  tick();
  state.clock = window.setInterval(tick, 30000);
}

function compass(degrees) {
  const names = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  return names[Math.round(degrees / 45) % 8];
}

function skyFor(code, isDay) {
  if (code === 0) return isDay ? "clear-day" : "clear-night";
  if (code === 1 || code === 2) return isDay ? "fair-day" : "fair-night";
  if (code === 3) return "overcast";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "overcast";
}

function markChip(place) {
  const buttons = chips.querySelectorAll(".chip");
  buttons.forEach((button, index) => {
    const quick = QUICK[index];
    const selected =
      quick.name === place.name &&
      Math.abs(quick.latitude - place.latitude) < 0.2 &&
      Math.abs(quick.longitude - place.longitude) < 0.2;
    button.setAttribute("aria-pressed", selected ? "true" : "false");
  });
}

function readSaved() {
  try {
    const raw = localStorage.getItem("twinweather-place") || localStorage.getItem("both-place");
    if (!raw) return null;
    const place = JSON.parse(raw);
    if (!place || typeof place.name !== "string" || place.name === "Current location") return null;
    if (!Number.isFinite(Number(place.latitude)) || !Number.isFinite(Number(place.longitude))) return null;
    return place;
  } catch {
    return null;
  }
}

function watchForReturn() {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") refreshIfStale();
  });
  window.addEventListener("pageshow", () => refreshIfStale());
  window.addEventListener("online", () => refreshIfStale());
}

function refreshIfStale() {
  if (!state.place || state.refreshing || state.locating) return;
  if (state.fetchedAt && Date.now() - state.fetchedAt < STALE_MS) return;
  void selectPlace(state.place, { remember: false });
}

function showPendingPlace(place) {
  state.hasForecast = false;
  $("place-name").textContent = place.name;
  $("place-region").textContent = [place.admin1, place.country].filter(Boolean).join(" · ");
  $("condition-label").textContent = "Loading";
  $("condition-icon").replaceChildren();
  for (const id of ["c-now", "f-now", "c-feels", "f-feels", "c-low", "f-low", "c-high", "f-high"]) {
    $(id).textContent = "—";
  }
  $("humidity").textContent = "—";
  $("wind").textContent = "—";
  $("rain").textContent = "—";
  $("uv").textContent = "—";
  $("hours").replaceChildren();
  $("days").replaceChildren();
  $("sunline").hidden = true;
  document.title = place.name;
}

function normalizePlace(place) {
  return {
    name: place.name,
    admin1: place.admin1 || "",
    country: place.country || "",
    latitude: Number(roundCoord(place.latitude)),
    longitude: Number(roundCoord(place.longitude)),
  };
}

function placeKey(place) {
  return `${Number(place.latitude).toFixed(2)},${Number(place.longitude).toFixed(2)}`;
}

function readForecastCache() {
  try {
    const raw = localStorage.getItem(FORECAST_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed;
  } catch {
    return {};
  }
}

function readCachedForecast(place) {
  const entry = readForecastCache()[placeKey(place)];
  if (!entry || !isUsableForecast(entry.forecast)) return null;
  return entry;
}

function writeCachedForecast(place, forecast) {
  try {
    const all = readForecastCache();
    all[placeKey(place)] = { place, forecast, savedAt: Date.now() };
    const entries = Object.entries(all).filter(([, entry]) => entry && isUsableForecast(entry.forecast));
    entries.sort((left, right) => (right[1].savedAt || 0) - (left[1].savedAt || 0));
    localStorage.setItem(FORECAST_KEY, JSON.stringify(Object.fromEntries(entries.slice(0, 8))));
  } catch {
    // A blocked or full store should not hide the forecast already on screen.
  }
}

function isUsableForecast(forecast) {
  const current = forecast?.current;
  if (!current || typeof forecast.timezone !== "string" || typeof current.time !== "string") return false;
  if (typeof current.isDay !== "boolean") return false;
  const numbers = [current.temperatureC, current.apparentC, current.humidity, current.weatherCode, current.windKmh, current.windDeg];
  if (numbers.some((value) => typeof value !== "number" || !Number.isFinite(value))) return false;
  if (!Array.isArray(forecast.hourly) || !Array.isArray(forecast.daily) || forecast.daily.length === 0) return false;
  const today = forecast.daily[0];
  if (!today || typeof today.minC !== "number" || typeof today.maxC !== "number") return false;
  if (typeof today.weatherCode !== "number" || typeof today.sunrise !== "string" || typeof today.sunset !== "string") return false;
  return forecast.hourly.every(
    (hour) =>
      hour &&
      typeof hour.time === "string" &&
      typeof hour.temperatureC === "number" &&
      typeof hour.weatherCode === "number" &&
      typeof hour.precipProb === "number" &&
      typeof hour.isDay === "boolean",
  );
}

function setRefreshing(active, label) {
  state.refreshing = active;
  const progress = $("progress");
  if (active) {
    progress.hidden = false;
    if (label) $("progress-label").textContent = label;
    setStatus("");
    return;
  }
  progress.hidden = true;
}

function setStatus(message) {
  $("status").textContent = message;
}

function icon(code, isDay) {
  if (code === 0) return isDay ? sun() : moon();
  if (code === 1 || code === 2) return isDay ? sunCloud() : moonCloud();
  if (code === 3 || code === 45 || code === 48) return cloud();
  if (code >= 71 && code <= 77) return snow();
  if (code === 85 || code === 86) return snow();
  if (code >= 95) return storm();
  if (code >= 51 && code <= 57) return drizzle();
  return rain();
}

function svg(paths) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function sun() {
  return svg(
    `<circle cx="12" cy="12" r="3.2"/><path d="M12 3.5v2.1M12 18.4v2.1M3.5 12h2.1M18.4 12h2.1M6 6l1.5 1.5M16.5 16.5 18 18M18 6l-1.5 1.5M7.5 16.5 6 18"/>`,
  );
}

function moon() {
  return svg(`<path d="M15.5 3.8A7.2 7.2 0 1 0 20 14.2 5.6 5.6 0 0 1 15.5 3.8z"/>`);
}

function cloud() {
  return svg(`<path d="M7.5 17.5h9.2a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-1.2A3.1 3.1 0 0 0 7.5 17.5z"/>`);
}

function sunCloud() {
  return svg(
    `<circle cx="8" cy="8" r="2.2"/><path d="M8 3.6v1.2M8 11.2v1.2M3.6 8h1.2M11.2 8h1.2M4.8 4.8l.8.8M10.4 10.4l.8.8M10.4 5.6l-.8.8M5.6 10.4l-.8.8"/><path d="M9.2 18.2h8.2a2.8 2.8 0 0 0 .3-5.6 3.8 3.8 0 0 0-7.2-1.1 2.6 2.6 0 0 0-1.3 6.7z"/>`,
  );
}

function moonCloud() {
  return svg(
    `<path d="M14.2 4.2A4.4 4.4 0 0 0 16 10"/><path d="M8.2 18.2h8.4a2.8 2.8 0 0 0 .2-5.6 3.9 3.9 0 0 0-7.4-.6 2.6 2.6 0 0 0-1.2 6.2z"/>`,
  );
}

function drizzle() {
  return svg(
    `<path d="M7.5 14.5h9.2a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-1.2A3.1 3.1 0 0 0 7.5 14.5z"/><path d="M9 17.2v1.6M12 17.6v1.6M15 17.2v1.6"/>`,
  );
}

function rain() {
  return svg(
    `<path d="M7.5 13.8h9.2a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-1.2A3.1 3.1 0 0 0 7.5 13.8z"/><path d="M8.5 16.2l-.7 2.2M12 16.5l-.7 2.2M15.5 16.2l-.7 2.2"/>`,
  );
}

function snow() {
  return svg(
    `<path d="M7.5 13.5h9.2a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-1.2A3.1 3.1 0 0 0 7.5 13.5z"/><circle cx="9" cy="17.4" r="0.9" fill="currentColor" stroke="none"/><circle cx="12" cy="18.6" r="0.9" fill="currentColor" stroke="none"/><circle cx="15" cy="17.4" r="0.9" fill="currentColor" stroke="none"/>`,
  );
}

function storm() {
  return svg(
    `<path d="M7.5 13.2h9.2a3.3 3.3 0 0 0 .4-6.6 4.6 4.6 0 0 0-8.8-1.2A3.1 3.1 0 0 0 7.5 13.2z"/><path d="M11.2 13.2 9.4 17h2.3l-1.2 3.2"/>`,
  );
}
