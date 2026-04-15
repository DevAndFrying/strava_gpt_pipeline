# Strava Activity Export SPA

A tiny local SPA for fetching recent Strava activities and copying a compact
JSON summary for ChatGPT.

## Run it

Install dependencies once:

```bash
npm install
```

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

Use `Load last 10` to list the most recent activity names and IDs. Each row has
a `Pull` button that loads that specific activity's detailed stats into the
cards and JSON output. You can also paste an activity ID into `Pull by activity
ID` to load one activity directly.

## Token notes

The preferred setup is to keep Strava credentials in local environment
variables. The browser calls the local server, and the local server calls Strava.

Do not commit or publish a real Strava token in frontend code. Anyone who can
load the page source could read it.

You can also use a short-lived token directly:

```bash
STRAVA_TOKEN=your_access_token node server.js
```

Strava access tokens expire, so the refresh-token setup is more reliable.

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
