const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 5174);
const root = __dirname;
const staticRoot = fsSync.existsSync(path.join(root, "dist")) ? path.join(root, "dist") : root;
const isDevelopment = process.env.NODE_ENV === "development";

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function loadDotEnv() {
  const envPath = path.join(root, ".env");

  if (!fsSync.existsSync(envPath)) {
    return;
  }

  const lines = fsSync.readFileSync(envPath, "utf8").split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separatorIndex = trimmed.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = trimmed.slice(0, separatorIndex).trim();
    let value = trimmed.slice(separatorIndex + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

function sendJson(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(body));
}

function sendHtml(response, statusCode, body) {
  response.writeHead(statusCode, {
    "Content-Type": "text/html; charset=utf-8",
  });
  response.end(body);
}

async function getAccessToken() {
  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;
  const refreshToken = process.env.STRAVA_REFRESH_TOKEN;

  if (clientId && clientSecret && refreshToken) {
    return refreshAccessToken(clientId, clientSecret, refreshToken);
  }

  const existingToken = process.env.STRAVA_TOKEN || process.env.STRAVA_ACCESS_TOKEN;

  if (existingToken) {
    return existingToken;
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Set STRAVA_TOKEN, or set STRAVA_CLIENT_ID, STRAVA_CLIENT_SECRET, and STRAVA_REFRESH_TOKEN.",
    );
  }
}

async function refreshAccessToken(clientId, clientSecret, refreshToken) {
  const response = await fetch("https://www.strava.com/oauth/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(data.message || `Token refresh failed with HTTP ${response.status}.`);
  }

  if (!data.access_token) {
    throw new Error("Token refresh succeeded but no access token was returned.");
  }

  return data.access_token;
}

function getCredentialMode() {
  if (
    process.env.STRAVA_CLIENT_ID &&
    process.env.STRAVA_CLIENT_SECRET &&
    process.env.STRAVA_REFRESH_TOKEN
  ) {
    return "refresh token";
  }

  if (process.env.STRAVA_TOKEN || process.env.STRAVA_ACCESS_TOKEN) {
    return "access token";
  }

  return "missing";
}

function getRedirectUri(request) {
  const host = request.headers.host || `localhost:${port}`;
  return `http://${host}/oauth/callback`;
}

function handleAuthorize(request, response) {
  const clientId = process.env.STRAVA_CLIENT_ID;

  if (!clientId) {
    sendHtml(
      response,
      500,
      "<h1>Missing STRAVA_CLIENT_ID</h1><p>Add STRAVA_CLIENT_ID to .env and restart node server.js.</p>",
    );
    return;
  }

  const authorizeUrl = new URL("https://www.strava.com/oauth/authorize");
  authorizeUrl.searchParams.set("client_id", clientId);
  authorizeUrl.searchParams.set("redirect_uri", getRedirectUri(request));
  authorizeUrl.searchParams.set("response_type", "code");
  authorizeUrl.searchParams.set("approval_prompt", "force");
  authorizeUrl.searchParams.set("scope", "read,activity:read_all");

  response.writeHead(302, {
    Location: authorizeUrl.toString(),
  });
  response.end();
}

async function handleOAuthCallback(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const code = requestUrl.searchParams.get("code");
  const scope = requestUrl.searchParams.get("scope") || "";
  const error = requestUrl.searchParams.get("error");

  if (error) {
    sendHtml(response, 400, `<h1>Strava authorization failed</h1><p>${escapeHtml(error)}</p>`);
    return;
  }

  if (!code) {
    sendHtml(response, 400, "<h1>Missing authorization code</h1>");
    return;
  }

  const clientId = process.env.STRAVA_CLIENT_ID;
  const clientSecret = process.env.STRAVA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    sendHtml(
      response,
      500,
      "<h1>Missing Strava app credentials</h1><p>Add STRAVA_CLIENT_ID and STRAVA_CLIENT_SECRET to .env, restart node server.js, then try again.</p>",
    );
    return;
  }

  try {
    const tokenResponse = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        code,
        grant_type: "authorization_code",
      }),
    });

    const data = await tokenResponse.json().catch(() => ({}));

    if (!tokenResponse.ok) {
      sendHtml(
        response,
        tokenResponse.status,
        `<h1>Token exchange failed</h1><pre>${escapeHtml(JSON.stringify(data, null, 2))}</pre>`,
      );
      return;
    }

    sendHtml(
      response,
      200,
      `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Strava Authorized</title>
    <style>
      body { font-family: system-ui, sans-serif; line-height: 1.5; margin: 32px; max-width: 860px; }
      code, pre { background: #f3f5f7; border: 1px solid #d7dee8; border-radius: 8px; }
      code { padding: 2px 5px; }
      pre { overflow: auto; padding: 16px; white-space: pre-wrap; }
    </style>
  </head>
  <body>
    <h1>Strava authorization complete</h1>
    <p>Scope returned by Strava: <code>${escapeHtml(scope)}</code></p>
    <p>Put this value in your <code>.env</code>, replacing the old <code>STRAVA_REFRESH_TOKEN</code>:</p>
    <pre>STRAVA_REFRESH_TOKEN=${escapeHtml(data.refresh_token || "")}</pre>
    <p>Then restart <code>node server.js</code> and fetch activities again.</p>
  </body>
</html>`,
    );
  } catch (exchangeError) {
    sendHtml(
      response,
      500,
      `<h1>Token exchange failed</h1><p>${escapeHtml(exchangeError.message)}</p>`,
    );
  }
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

async function handleActivities(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const perPage = requestUrl.searchParams.get("per_page") || "10";
    const data = await fetchStravaJson("/athlete/activities", {
      per_page: perPage,
    });

    sendJson(response, 200, data);
  } catch (error) {
    sendStravaError(response, error, "Could not fetch Strava activities.");
  }
}

async function handleActivityDetail(request, response) {
  try {
    const requestUrl = new URL(request.url, `http://${request.headers.host}`);
    const id = requestUrl.pathname.split("/").pop();

    if (!/^\d+$/.test(id)) {
      sendJson(response, 400, {
        message: "Activity id must be numeric.",
      });
      return;
    }

    const data = await fetchStravaJson(`/activities/${id}`, {
      include_all_efforts: "true",
    });

    sendJson(response, 200, data);
  } catch (error) {
    sendStravaError(response, error, "Could not fetch Strava activity detail.");
  }
}

async function fetchStravaJson(pathname, searchParams = {}) {
  const stravaUrl = new URL(`https://www.strava.com/api/v3${pathname}`);

  for (const [key, value] of Object.entries(searchParams)) {
    stravaUrl.searchParams.set(key, value);
  }

  const accessToken = await getAccessToken();
  const stravaResponse = await fetch(stravaUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = await stravaResponse.json().catch(() => null);

  if (!stravaResponse.ok) {
    const error = new Error(
      data?.message ||
        `Strava returned HTTP ${stravaResponse.status}. Check token, scopes, and expiration.`,
    );
    error.statusCode = stravaResponse.status;
    error.details = data;
    throw error;
  }

  return data;
}

function sendStravaError(response, error, fallbackMessage) {
  sendJson(response, error.statusCode || 500, {
    message: error.message || fallbackMessage,
    credential_mode: getCredentialMode(),
    details: error.details || null,
  });
}

async function serveStatic(request, response) {
  const requestUrl = new URL(request.url, `http://${request.headers.host}`);
  const requestedPath = requestUrl.pathname === "/" ? "/index.html" : requestUrl.pathname;
  const filePath = path.normalize(path.join(staticRoot, requestedPath));

  if (!filePath.startsWith(staticRoot)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await fs.readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes[path.extname(filePath)] || "application/octet-stream",
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404, {
      "Content-Type": "text/plain; charset=utf-8",
    });
    response.end("File not found");
  }
}

async function createViteDevServer() {
  if (!isDevelopment) {
    return null;
  }

  const { createServer } = await import("vite");

  return createServer({
    appType: "spa",
    server: {
      middlewareMode: true,
    },
  });
}

function handleRequest(viteDevServer, request, response) {
  if (request.url.startsWith("/api/authorize")) {
    handleAuthorize(request, response);
    return;
  }

  if (request.url.startsWith("/oauth/callback")) {
    handleOAuthCallback(request, response);
    return;
  }

  if (request.url.startsWith("/api/activities/")) {
    handleActivityDetail(request, response);
    return;
  }

  if (request.url.startsWith("/api/activities")) {
    handleActivities(request, response);
    return;
  }

  if (viteDevServer) {
    viteDevServer.middlewares(request, response, () => {
      response.writeHead(404, {
        "Content-Type": "text/plain; charset=utf-8",
      });
      response.end("File not found");
    });
    return;
  }

  serveStatic(request, response);
}

loadDotEnv();

startServer();

async function startServer() {
  const viteDevServer = await createViteDevServer();
  const server = http.createServer((request, response) => {
    handleRequest(viteDevServer, request, response);
  });

  server.listen(port, () => {
    console.log(`Strava export running at http://localhost:${port}/`);
    console.log(`Credential mode: ${getCredentialMode()}`);

    if (viteDevServer) {
      console.log("React dev server: enabled on the same port");
    }
  });
}
