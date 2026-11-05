const fs = require("node:fs/promises");
const path = require("node:path");
const { unzipSync } = require("fflate");

const baseUrl = "https://personal.connectapi.garmin.com";
const tokenPath = "/personalapitoken-service/personal-api/personal-api-key/token";
const maxDownloadBytes = 64 * 1024 * 1024;

function apiError(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

function createGarminService({ dataDir, fetchImpl = (...args) => fetch(...args), env = process.env }) {
  const authPath = path.join(dataDir, ".garmin-auth.json");
  const activitiesPath = path.join(dataDir, ".garmin-activities.json");
  let cachedToken = null;
  let syncPromise = null;

  async function readJson(file, fallback) {
    try {
      return JSON.parse(await fs.readFile(file, "utf8"));
    } catch (error) {
      if (error.code === "ENOENT") return fallback;
      throw apiError("Could not read saved Garmin data. Check the server data directory.", 500);
    }
  }

  async function writeJson(file, value) {
    await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
    await fs.writeFile(`${file}.tmp`, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
    await fs.chmod(`${file}.tmp`, 0o600);
    await fs.rename(`${file}.tmp`, file);
  }

  async function getKey() {
    return env.GARMIN_PERSONAL_API_KEY?.trim() || (await readJson(authPath, {})).api_key || "";
  }

  async function request(url, options) {
    try {
      return await fetchImpl(url, { ...options, signal: AbortSignal.timeout(30_000), redirect: "error" });
    } catch (error) {
      throw apiError("Could not reach Garmin. Check your connection and try again.");
    }
  }

  function checkResponse(response) {
    if (response.ok) return;
    if (response.status === 401 || response.status === 403) {
      throw apiError("Garmin authorization failed. Check that your Personal API key is valid and has not expired or been revoked.", response.status);
    }
    if (response.status === 429) {
      throw apiError("Garmin rate limit reached. Wait a while before syncing again.", 429);
    }
    // Never forward upstream bodies: they may contain credential information.
    throw apiError(`Garmin returned HTTP ${response.status}. Try syncing again later.`);
  }

  async function obtainToken(key, force = false) {
    if (!force && cachedToken?.key === key && cachedToken.expiresAt > Date.now() + 60_000) {
      return cachedToken.token;
    }
    const response = await request(`${baseUrl}${tokenPath}`, {
      method: "POST",
      headers: { Authorization: `ApiKey ${key}`, Accept: "*/*" },
    });
    checkResponse(response);
    // Garmin returns a plain-text JWT, rather than an OAuth JSON object.
    const token = (await response.text()).trim();
    let expiresAt;
    try {
      const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
      expiresAt = Number(payload.exp) * 1000;
    } catch (error) {
      throw apiError("Garmin returned an invalid access token.");
    }
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      throw apiError("Garmin returned an expired or invalid access token.");
    }
    cachedToken = { key, token, expiresAt };
    return token;
  }

  async function getResponse(pathname, key, params = {}, accept = "application/json") {
    const url = new URL(pathname, baseUrl);
    for (const [name, value] of Object.entries(params)) url.searchParams.set(name, String(value));
    let token = await obtainToken(key);
    let response = await request(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
    if (response.status === 401) {
      token = await obtainToken(key, true);
      response = await request(url, { headers: { Authorization: `Bearer ${token}`, Accept: accept } });
    }
    checkResponse(response);
    return response;
  }

  async function getJson(pathname, key, params = {}) {
    const response = await getResponse(pathname, key, params);
    try {
      return await response.json();
    } catch (error) {
      throw apiError("Garmin returned an unexpected response.");
    }
  }

  async function getState() {
    const saved = await readJson(activitiesPath, { activities: [], last_synced_at: null });
    return {
      has_api_key: Boolean(await getKey()),
      is_api_key_from_env: Boolean(env.GARMIN_PERSONAL_API_KEY?.trim()),
      activities: saved.activities,
      last_synced_at: saved.last_synced_at,
    };
  }

  async function saveKey(value) {
    if (env.GARMIN_PERSONAL_API_KEY?.trim()) {
      throw apiError("Garmin uses GARMIN_PERSONAL_API_KEY from the server environment. Update it there to change the key.", 409);
    }
    if (typeof value !== "string" || !value.trim() || /\s/.test(value.trim()) || value.length > 4096) {
      throw apiError("Enter a valid Garmin Connect Personal API key.", 400);
    }
    const key = value.trim();
    await obtainToken(key);
    await writeJson(authPath, { api_key: key });
    return getState();
  }

  async function performSync(limit) {
    const key = await getKey();
    if (!key) throw apiError("Save a Garmin Connect Personal API key before syncing.", 400);
    const activities = [];
    // Paginate even when Garmin returns fewer rows than requested.
    while (activities.length < limit) {
      const page = await getJson("/activitylist-service/activities/search/activities", key, {
        start: activities.length,
        limit: Math.min(20, limit - activities.length),
      });
      if (!Array.isArray(page)) throw apiError("Garmin returned an unexpected activity list.");
      if (page.length === 0) break;
      activities.push(...page.slice(0, limit - activities.length));
    }
    const details = [];
    for (const activity of activities) {
      if (!/^\d+$/.test(String(activity?.activityId))) {
        throw apiError("Garmin returned an activity without a valid ID.");
      }
      const detail = await getJson(`/activity-service/activity/${activity.activityId}`, key);
      if (!detail || typeof detail !== "object" || Array.isArray(detail)) {
        throw apiError("Garmin returned unexpected activity details.");
      }
      details.push({ ...activity, ...detail, activityId: activity.activityId });
    }
    const saved = await readJson(activitiesPath, { activities: [] });
    const byId = new Map(saved.activities.map((activity) => [String(activity.activityId), activity]));
    for (const activity of details) byId.set(String(activity.activityId), activity);
    await writeJson(activitiesPath, {
      activities: [...byId.values()],
      last_synced_at: new Date().toISOString(),
    });
    return { ...(await getState()), synced_count: details.length };
  }

  async function sync(limit = 10) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
      throw apiError("Request between 1 and 50 Garmin activities.", 400);
    }
    if (syncPromise) throw apiError("A Garmin sync is already running.", 409);
    syncPromise = performSync(limit);
    try {
      return await syncPromise;
    } finally {
      syncPromise = null;
    }
  }

  async function downloadFit(activityId) {
    const id = String(activityId ?? "");
    if (!/^[1-9]\d*$/.test(id)) throw apiError("Garmin activity ID must be a positive integer.", 400);
    const key = await getKey();
    if (!key) throw apiError("Save a Garmin Connect Personal API key before downloading FIT files.", 400);
    const response = await getResponse(`/download-service/files/activity/${id}`, key, {}, "application/zip");
    let content;
    try {
      if (Number(response.headers.get("content-length")) > maxDownloadBytes) throw new Error("Download too large");
      content = Buffer.from(await response.arrayBuffer());
      if (content.length > maxDownloadBytes) throw new Error("Download too large");
      // Personal API downloads are ZIP archives. Extract in memory, without writing upstream paths.
      let fitCount = 0;
      const files = unzipSync(content, {
        filter: (file) => {
          if (!/\.fit$/i.test(file.name)) return false;
          if (++fitCount > 1) throw new Error("Unexpected number of FIT files");
          if (file.originalSize > maxDownloadBytes) throw new Error("FIT file too large");
          return true;
        },
      });
      const fits = Object.values(files);
      if (fits.length === 0) throw apiError("This Garmin activity has no original FIT file available.", 404);
      content = Buffer.from(fits[0]);
      if (content.length < 12 || content.toString("ascii", 8, 12) !== ".FIT") throw new Error("Invalid FIT file");
    } catch (error) {
      if (error.statusCode) throw error;
      throw apiError("Could not read the FIT file from Garmin's activity download.");
    }
    return { content, filename: `garmin-${id}.fit` };
  }

  return { getState, saveKey, sync, downloadFit };
}

module.exports = { createGarminService };
