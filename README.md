# Strava Activity Export SPA

A tiny local SPA for fetching recent Strava activities and copying a compact
JSON summary for ChatGPT.

## Run it

Install dependencies once:

```bash
npm install
```

### Configure `.env`

Create a `.env` file in the repo root before fetching Strava data. The
recommended setup uses your Strava app credentials plus a refresh token:

```dotenv
STRAVA_CLIENT_ID=your_strava_client_id
STRAVA_CLIENT_SECRET=your_strava_client_secret
STRAVA_REFRESH_TOKEN=your_strava_refresh_token
```

With those three values present, the local server automatically exchanges the
refresh token for a fresh access token whenever it calls Strava.

To get the initial refresh token:

1. Create or open your Strava API application.
2. Set its authorization callback domain to `localhost` for local use.
3. Add `STRAVA_CLIENT_ID` and `STRAVA_CLIENT_SECRET` to `.env`.
4. Start the app, then visit `http://localhost:5174/api/authorize`.
5. Approve the requested scopes, copy the returned `STRAVA_REFRESH_TOKEN` into
   `.env`, and restart the app.

For a quick test, you can use a short-lived access token instead:

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

Choose how many activities to request and click `Fetch from Strava`.

When you leave the token field blank, the app uses the local server credentials
and fetches detailed stats for each returned activity. That uses one request for
the activity list plus one request per activity, so a limit of `10` uses `11`
Strava API requests.

The split unit selector changes split distances and speeds between miles and
kilometers without refetching. Detailed exports include every split returned by
Strava for each activity.

Use `Recent activities` to choose how many recent activity names and IDs to
load. Each row has a `Pull` button that loads that specific activity's detailed
stats into the cards and JSON output. You can also paste an activity ID into
`Pull by activity ID` to load one activity directly.

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
