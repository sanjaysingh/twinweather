# Twinweather

Current weather for any city, with Celsius and Fahrenheit on screen together. There is no unit switch. Fahrenheit is calculated from the Celsius reading, so the two numbers always describe the same temperature.

**https://twinweather.sanjaysingh.net**

The current reading is one line, `18°C | 64°F`. The next 24 hours and the next seven days keep both scales, stacked. The page also shows how the air feels, today's range, humidity, wind, the chance of rain, and today's UV. Local time and sunrise to sunset sit beside the city name.

Search opens over the page and closes after a place is chosen. On a later visit the last city is remembered in the browser. The first visit uses New York, unless location permission was already granted.

The address bar follows the city on screen. Copy that link to open the same place. The share card shows that city's weather, in both Celsius and Fahrenheit. A link with no city uses New York.

On a phone, Twinweather can be added to the home screen and opened like an app.

## How the weather is chosen

Open-Meteo sends an hour-by-hour forecast. The page reads that forecast three ways.

**Right now.** The condition at the top is the current observation. The rain chance next to humidity and wind is the chance for the current hour, and it is always shown.

**Next 24 hours.** Each cell is that hour on its own. Night hours stay in this row. A cell prints a chance only when that hour is at least 15%.

**Each of the next seven days.** The icon, the word, and the chance describe the hours from sunrise up to sunset. An hour counts when its timestamp is at or after sunrise and before sunset. Rain before sunrise or after sunset stays on the hourly row and does not change the day.

Within those hours, the day is the sky that covers the most hours. Sunny, mostly sunny, partly sunny, cloudy, and fog compete the same way. A tie goes to the clearer sky.

Precipitation replaces that sky in two cases:

- Wet hours, taken together, outnumber the most common dry sky. A tie stays with the sky.
- Or the chance of the main precipitation type is at least 15%.

A wet hour at 0% does not count. One 2% drizzle hour does not rename a sunny day. A day that is mostly drizzle still says drizzle, and the chance is shown even when it is under 15%.

When precipitation wins, the word is the type with the most daylight water, such as light drizzle, drizzle, or dense drizzle. If two types bring the same amount, the one that lasts more hours wins, and a remaining tie goes to the heavier type. The chance is the highest chance among hours of that same type, so a brief 40% shower is not paired with a heavier type from another hour. If none of those hours has measurable water, the type with the highest chance is used.

When the sky wins, the chance is the highest chance of any daylight hour. It is printed only at 15% or above, including next to a sunny or cloudy label.

If the forecast has no hours inside sunrise and sunset, the day falls back to Open-Meteo's own full-day summary.

## How it is hosted

The Cloudflare Worker serves the site and the API on `twinweather.sanjaysingh.net`. It fills in the share card for the city in the link. GitHub Pages receives the same static files.

| Request | What happens |
| --- | --- |
| Pages, styles, and the app icon | The Worker, from the files in `public/` |
| `/` and `/?l=40.71,-74.01` | Share image for that point. The title and description stay the same. No point means New York. |
| `/api/og.png` | The share image |
| `/api/forecast` | Open-Meteo forecast, shaped for the page |
| `/api/geocode` | Open-Meteo place search |
| `/api/reverse` | Nominatim, used when the browser shares a location |

The Worker does not keep accounts or search history. A successful response may be cached briefly at the edge: forecasts for about 10 minutes, place names for about a day. The last chosen city stays in `localStorage` on the device.

Weather data is from [Open-Meteo](https://open-meteo.com/), under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). The footer link is required by that license.

## Local development

```bash
npm ci
npm run dev
```

Wrangler prints the local URL. The Worker and the static files are served together, so search and the forecast use `/api` on that same origin.

## Publishing

Pushes to `main` publish automatically.

- Changes under `public/` deploy the site to GitHub Pages.
- Changes to the Worker, `wrangler.jsonc`, or the dependency lockfile deploy the Worker.

The Worker deploy needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token is the Cloudflare **Edit Cloudflare Workers** template, scoped to this account and the `sanjaysingh.net` zone.

## License

The app is [MIT](LICENSE). Open-Meteo data keeps its own license, linked above.
