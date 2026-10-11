# Twinweather

Current weather for any city, with Celsius and Fahrenheit on screen together. There is no unit switch. Fahrenheit is calculated from the Celsius reading, so the two numbers always describe the same temperature.

**https://twinweather.sanjaysingh.net**

The current reading is one line, `18°C | 64°F`. The next 24 hours and the next seven days keep both scales, stacked. The page also shows how the air feels, today's range, humidity, wind, the chance of rain, and today's UV. Local time and sunrise to sunset sit beside the city name.

Search opens over the page and closes after a place is chosen. On a later visit the last city is remembered in the browser. The first visit uses New York, unless location permission was already granted.

On a phone, Twinweather can be added to the home screen and opened like an app.

## How it is hosted

The pages are static files on GitHub Pages. `https://twinweather.sanjaysingh.net/api/*` is a Cloudflare Worker on the same hostname.

| Request | What happens |
| --- | --- |
| Pages, styles, and the app icon | GitHub Pages |
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
