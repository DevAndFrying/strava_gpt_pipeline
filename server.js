const http = require("node:http");
const fs = require("node:fs/promises");
const fsSync = require("node:fs");
const path = require("node:path");

const port = Number(process.env.PORT || 5174);
const root = __dirname;
const staticRoot = fsSync.existsSync(path.join(root, "dist")) ? path.join(root, "dist") : root;
const isDevelopment = process.env.NODE_ENV === "development";
const localAuthPath = path.join(root, ".strava-auth.json");

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

function loadLocalAuth() {
  if (!fsSync.existsSync(localAuthPath)) {
    return {};
  }

  try {
    return JSON.parse(fsSync.readFileSync(localAuthPath, "utf8"));
  } catch (error) {
    return {};
  }
}

async function saveLocalAuth(auth) {
  const nextPath = `${localAuthPath}.tmp`;

  await fs.writeFile(nextPath, `${JSON.stringify(auth, null, 2)}\n`, {
    mode: 0o600,
  });
  await fs.rename(nextPath, localAuthPath);
  await fs.chmod(localAuthPath, 0o600);
}

function getRefreshToken() {
  return process.env.STRAVA_REFRESH_TOKEN || loadLocalAuth().refresh_token;
}

function getClientId() {
  return process.env.STRAVA_CLIENT_ID || loadLocalAuth().client_id;
}

function getClientSecret() {
  return process.env.STRAVA_CLIENT_SECRET || loadLocalAuth().client_secret;
}

async function getAccessToken() {
  const clientId = getClientId();
  const clientSecret = getClientSecret();
  const refreshToken = getRefreshToken();

  if (clientId && clientSecret && refreshToken) {
    return refreshAccessToken(clientId, clientSecret, refreshToken);
  }

  const existingToken = process.env.STRAVA_TOKEN || process.env.STRAVA_ACCESS_TOKEN;

  if (existingToken) {
    return existingToken;
  }

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error(
      "Set Strava app settings in the app, authorize with Strava, or set STRAVA_TOKEN.",
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

  if (data.refresh_token && data.refresh_token !== refreshToken) {
    const existingAuth = loadLocalAuth();
    process.env.STRAVA_REFRESH_TOKEN = data.refresh_token;
    await saveLocalAuth({
      ...existingAuth,
      refresh_token: data.refresh_token,
      updated_at: new Date().toISOString(),
    });
  }

  return data.access_token;
}

function getCredentialMode() {
  if (getClientId() && getClientSecret() && getRefreshToken()) {
    return process.env.STRAVA_REFRESH_TOKEN ? "refresh token" : "stored refresh token";
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

function redirectHome(response, params = {}) {
  const searchParams = new URLSearchParams(params);
  const location = searchParams.size > 0 ? `/?${searchParams}` : "/";

  response.writeHead(302, {
    Location: location,
  });
  response.end();
}

function handleAuthorize(request, response) {
  const clientId = getClientId();

  if (!clientId) {
    sendHtml(
      response,
      500,
      "<h1>Missing Strava client ID</h1><p>Add Strava settings in the app, then try again.</p>",
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
    redirectHome(response, {
      strava_authorized: "0",
      strava_error: error,
    });
    return;
  }

  if (!code) {
    redirectHome(response, {
      strava_authorized: "0",
      strava_error: "missing_code",
    });
    return;
  }

  const clientId = getClientId();
  const clientSecret = getClientSecret();

  if (!clientId || !clientSecret) {
    redirectHome(response, {
      strava_authorized: "0",
      strava_error: "missing_app_credentials",
    });
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
      redirectHome(response, {
        strava_authorized: "0",
        strava_error: data.message || `token_exchange_failed_${tokenResponse.status}`,
      });
      return;
    }

    if (!data.refresh_token) {
      redirectHome(response, {
        strava_authorized: "0",
        strava_error: "missing_refresh_token",
      });
      return;
    }

    process.env.STRAVA_REFRESH_TOKEN = data.refresh_token;
    const existingAuth = loadLocalAuth();
    await saveLocalAuth({
      ...existingAuth,
      athlete: data.athlete
        ? {
            id: data.athlete.id,
            username: data.athlete.username,
            firstname: data.athlete.firstname,
            lastname: data.athlete.lastname,
          }
        : null,
      refresh_token: data.refresh_token,
      scope,
      updated_at: new Date().toISOString(),
    });

    redirectHome(response, {
      strava_authorized: "1",
    });
  } catch (exchangeError) {
    redirectHome(response, {
      strava_authorized: "0",
      strava_error: exchangeError.message || "token_exchange_failed",
    });
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

function readRequestJson(request, maxBytes = 20_000) {
  return new Promise((resolve, reject) => {
    let body = "";

    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;

      if (body.length > maxBytes) {
        reject(new Error("Request body is too large."));
        request.destroy();
      }
    });
    request.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }

      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("Request body must be valid JSON."));
      }
    });
    request.on("error", reject);
  });
}

function getSettingsSummary() {
  const localAuth = loadLocalAuth();
  const clientId = getClientId();

  return {
    client_id: clientId || "",
    credential_mode: getCredentialMode(),
    has_client_id: Boolean(clientId),
    has_client_secret: Boolean(getClientSecret()),
    has_refresh_token: Boolean(getRefreshToken()),
    is_client_id_from_env: Boolean(process.env.STRAVA_CLIENT_ID),
    is_client_secret_from_env: Boolean(process.env.STRAVA_CLIENT_SECRET),
    is_refresh_token_from_env: Boolean(process.env.STRAVA_REFRESH_TOKEN),
    stored_updated_at: localAuth.updated_at || null,
  };
}

async function handleSettings(request, response) {
  if (request.method === "GET") {
    sendJson(response, 200, getSettingsSummary());
    return;
  }

  if (request.method !== "POST") {
    sendJson(response, 405, {
      message: "Method not allowed.",
    });
    return;
  }

  try {
    const body = await readRequestJson(request);
    const clientId = String(body.client_id || "").trim();
    const clientSecret = String(body.client_secret || "").trim();

    if (!clientId || !clientSecret) {
      sendJson(response, 400, {
        message: "Client ID and client secret are required.",
      });
      return;
    }

    const existingAuth = loadLocalAuth();
    await saveLocalAuth({
      ...existingAuth,
      client_id: clientId,
      client_secret: clientSecret,
      updated_at: new Date().toISOString(),
    });

    sendJson(response, 200, getSettingsSummary());
  } catch (error) {
    sendJson(response, 400, {
      message: error.message || "Could not save settings.",
    });
  }
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
  if (request.url.startsWith("/api/settings")) {
    handleSettings(request, response);
    return;
  }

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
