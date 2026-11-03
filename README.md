# Strava Activity Export SPA

A tiny local SPA for fetching recent Strava activities, syncing Garmin Connect
activities, comparing matching recordings, and copying JSON for ChatGPT.

## Run it

Install dependencies once:

```bash
npm install
```

### Configure Strava app credentials

The easiest setup is to enter your Strava app credentials in the app:

1. Start the app.
2. Paste your Strava client ID and client secret into `Strava app settings`.
3. Click `Save Strava settings`.
4. Click `Authorize with Strava`.
5. Approve the requested scopes, then return to the app and fetch activities.

The local server saves credentials and the returned refresh token to
`.strava-auth.json`, which is ignored by git. The client secret stays on the
local server. The browser does not store it in localStorage.

You can still use `.env` if you prefer environment variables:

```dotenv
STRAVA_CLIENT_ID=your_strava_client_id
STRAVA_CLIENT_SECRET=your_strava_client_secret
```

Environment variables take precedence over `.strava-auth.json`. You can also
set `STRAVA_REFRESH_TOKEN` in `.env`, though the app authorization flow usually
handles that for you.

For a quick test, you can still use a short-lived access token on the server:

```dotenv
STRAVA_TOKEN=your_access_token
```

`STRAVA_ACCESS_TOKEN` is also accepted as an alias. Access tokens expire, so the
refresh-token setup is more reliable.

Start the app in development mode:

```bash
npm run dev
```

Then visit:

```text
http://localhost:5174
```

Development mode serves React and the Strava API from the same port, so there
is no Vite proxy port to keep in sync.

For a production-style local run, build the React app and serve it through the
same Node server:

```bash
npm run build
npm start
```

Then visit:

```text
http://localhost:5174
```

## Run with Docker

Build and start the container:

```bash
docker compose up -d --build
```

Then visit:

```text
http://localhost:5174
```

The Compose service uses `restart: unless-stopped`, so it comes back after
Docker starts on boot unless you explicitly stop it.

Containerized auth data is stored in the named volume
`strava-gpt-pipeline-data` at `/data/.strava-auth.json`. That keeps your saved
Strava client settings and refresh token across container rebuilds.

If you prefer to provide credentials through environment variables instead of
the app UI, add them under the service `environment:` block in
`docker-compose.yml` or use a Compose env file:

```dotenv
STRAVA_CLIENT_ID=your_strava_client_id
STRAVA_CLIENT_SECRET=your_strava_client_secret
STRAVA_REFRESH_TOKEN=your_refresh_token
```

To stop the container:

```bash
docker compose down
```

Choose how many activities to request and click `Fetch from Strava`.

The app uses the local server authorization and fetches detailed stats for each
returned activity. That uses one request for the activity list plus one request
per activity, so a limit of `10` uses `11` Strava API requests.

The split unit selector changes split distances and speeds between miles and
kilometers without refetching. Detailed exports include every split returned by
Strava for each activity. When Strava reports an activity's average temperature,
the JSON export and activity cards show it in both Celsius and Fahrenheit and
label it separately from modeled Open-Meteo conditions.
For detailed outdoor activities with a start location, the server also requests
hourly modeled weather from Open-Meteo and adds humidity and apparent ("feels
like") temperature at the activity start. The request sends the activity's start
coordinates and UTC date to Open-Meteo; it does not require an API key. Weather
lookup failures do not prevent the Strava activity from loading.

The export uses Strava's `start_date` as the canonical UTC timestamp. It also
includes `started_at_local` with an explicit UTC offset and the activity's IANA
`timezone`. Open-Meteo's nearest hourly sample remains in `weather_at`, with its
difference from the exact activity start in `weather_sample_offset_seconds`.

Use `Recent activities` to choose how many recent activity names and IDs to
load. Each row has a `Pull` button that loads that specific activity's detailed
stats into the cards and JSON output. You can also paste an activity ID into
`Pull by activity ID` to load one activity directly.

## Sync Garmin Connect and compare recordings

1. Sign in to [Garmin Connect Personal API settings](https://connect.garmin.com/app/settings/personalApiToken)
   and create a Personal API key. Garmin displays it only once.
2. Click **Garmin Connect** in the top bar to open the modal. Paste the key into
   **Garmin Personal API key** and click **Save Garmin key**.
   The server verifies the key with Garmin before saving it.
3. Choose **Activities to sync** (1–50) in the modal and click **Sync Garmin**. The app
   imports recent activities and their detailed metrics. Click again to refresh them.
4. Fetch Strava activities or pull a specific Strava activity to compare detailed
   metrics. Until you do, comparisons use the recent Strava list already loaded.
5. Open the Garmin modal and expand a matched activity to see Strava and Garmin
   values and their differences. Close it with the close button, Escape, or a
   click outside the dialog. Imported data remains available after closing it.

This uses Garmin's official [Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api/)
and the activity endpoints documented in Garmin's
[reference client](https://github.com/garmin/connect-personal-api-python).
The server exchanges the key for a short-lived bearer token and renews it as needed.
It never returns either credential to the browser or stores it in localStorage.
Instead of entering a key in the app, you can set this server environment variable:

```dotenv
GARMIN_PERSONAL_API_KEY=your_personal_api_key
```

The environment variable takes precedence; update it on the server to replace
an environment-configured key. In Docker, pass it through the service's
`environment:` block or a Compose env file, just like the Strava settings.

The key is stored in `.garmin-auth.json` with owner-only permissions. Imported
activities are stored separately in `.garmin-activities.json`, also with owner-only
permissions. Both live under `DATA_DIR` (the project directory by default, `/data`
in Docker), are ignored by git and Docker's build context, and survive restarts.
Each sync updates existing Garmin activity IDs and retains previously imported
activities. A failed sync preserves the last successful import.

Matching uses the absolute difference between UTC activity **start times**, with
an inclusive **300-second** window. Garmin GMT fields without a timezone are
treated as UTC; local-only or invalid timestamps are left unmatched. Closest
pairs are selected first, each entry is used once, and ties are resolved by ID.
Matching is based on time, so the comparison also shows differences in names or
sport types. These are candidate matches, useful for checking two recordings of
the same workout; entries are not merged or deleted.

The table compares distance and elevation in meters, durations in seconds,
speeds in meters per second, heart rate in bpm, calories in kcal, power in watts,
and temperature in Celsius. Numeric differences are **Garmin minus Strava**,
rounded to three decimals. Missing values remain unavailable instead of becoming
zero. Garmin's timer duration is not substituted for moving or elapsed time.
The split-unit selector continues to control Strava splits; comparison units stay
fixed so both sources can be compared directly.

Once Garmin activities have been imported, **Copy JSON** exports an object with
`strava`, `garmin`, and `comparisons` fields, including matched pairs, per-field
differences, and unmatched IDs. Without imported Garmin activities, the existing
Strava-only array format is preserved. Garmin-only exports also work.

## Verify changes

```bash
npm test
npm run build
```

Tests use mocked Garmin responses and temporary data directories; no real
credentials or external API calls are needed.

## Token notes

The preferred setup is to keep Strava credentials in local environment
variables. The browser calls the local server, and the local server calls Strava.

Do not commit or publish a real Strava token in frontend code. Anyone who can
load the page source could read it.

A `401` from Strava means the request reached Strava, but the token was not
accepted. Check these first:

- Use the short-lived OAuth access token, not the client secret.
- Generate the token for the same athlete account whose activities you want.
- Include `activity:read` for public activities or `activity:read_all` for
  private activities.
- Refresh or regenerate the token if it expired.

You do not need to pass an athlete number for the activities endpoint. Strava
uses the bearer token to identify the authenticated athlete. Athlete IDs are
needed for endpoints such as `/athletes/{id}/stats`.

## If the browser blocks Strava

Some APIs do not allow direct browser calls from local pages because of CORS.
If the SPA shows a CORS-style network error, use this Node script instead and
paste the output into ChatGPT:

```js
import fetch from "node-fetch";

const token = process.env.STRAVA_TOKEN;

async function getActivities() {
  const res = await fetch("https://www.strava.com/api/v3/athlete/activities", {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  const data = await res.json();
  console.log(JSON.stringify(data.slice(0, 3), null, 2));
}

getActivities();
```
