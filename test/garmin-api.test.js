const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { Readable } = require("node:stream");

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "garmin-api-test-"));
const originalDataDir = process.env.DATA_DIR;
const originalKey = process.env.GARMIN_PERSONAL_API_KEY;
process.env.DATA_DIR = dataDir;
delete process.env.GARMIN_PERSONAL_API_KEY;
const { handleRequest } = require("../server.js");
test.after(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
  if (originalDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = originalDataDir;
  if (originalKey === undefined) delete process.env.GARMIN_PERSONAL_API_KEY;
  else process.env.GARMIN_PERSONAL_API_KEY = originalKey;
});

function request(url, { method = "GET", body = "", vite = null } = {}) {
  return new Promise((resolve, reject) => {
    const incoming = Readable.from(body ? [body] : []);
    Object.assign(incoming, { url, method, headers: { host: "localhost" } });
    const headers = {};
    const response = {
      setHeader(name, value) { headers[name.toLowerCase()] = value; },
      writeHead(status, extra = {}) { this.status = status; Object.assign(headers, extra); },
      end(value = "") { resolve({ status: this.status, headers, body: String(value) }); },
    };
    try { handleRequest(vite, incoming, response); } catch (error) { reject(error); }
  });
}

test("Garmin API saves credentials, syncs, and returns imported entries without credentials", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => { global.fetch = originalFetch; });
  global.fetch = async (url, options) => {
    if (options.method === "POST") {
      assert.equal(options.headers.Authorization, "ApiKey api-test-key");
      return new Response(`header.${Buffer.from(JSON.stringify({ exp: Date.now() / 1000 + 3600 })).toString("base64url")}.signature`);
    }
    if (String(url).includes("activitylist-service")) return Response.json([{ activityId: 10 }]);
    return Response.json({ activityId: 10, activityName: "Test activity", summaryDTO: { distance: 5000 } });
  };
  const before = await request("/api/garmin");
  assert.equal(before.status, 200);
  assert.equal(JSON.parse(before.body).has_api_key, false);
  const save = await request("/api/garmin/settings", { method: "POST", body: JSON.stringify({ api_key: "api-test-key" }) });
  assert.equal(save.status, 200);
  assert.equal(JSON.parse(save.body).has_api_key, true);
  assert.ok(!save.body.includes("api-test-key"));
  const sync = await request("/api/garmin/sync", { method: "POST", body: JSON.stringify({ limit: 1 }) });
  assert.equal(sync.status, 200);
  assert.equal(JSON.parse(sync.body).synced_count, 1);
  const after = await request("/api/garmin");
  assert.equal(JSON.parse(after.body).activities[0].summaryDTO.distance, 5000);
  assert.equal(after.headers["cache-control"], "no-store");
  assert.ok(!after.body.includes("api-test-key"));
});

test("Garmin API validates bodies, limits, and HTTP methods", async () => {
  for (const url of ["/api/garmin/settings", "/api/garmin/sync"]) {
    assert.equal((await request(url, { method: "POST", body: "{" })).status, 400);
    assert.equal((await request(url)).status, 405);
  }
  assert.equal((await request("/api/garmin/settings", { method: "POST", body: "null" })).status, 400);
  assert.equal((await request("/api/garmin/sync", { method: "POST", body: '{"limit":51}' })).status, 400);
});

test("credential files cannot be served in production or through Vite development middleware", async () => {
  const paths = ["/.garmin-auth.json", "/.garmin-activities.json", "/.garmin-auth.json.tmp", "/%2egarmin-auth.json?raw", "/.strava-auth.json", "/.env", "/@fs/tmp/.garmin-auth.json"];
  for (const url of paths) {
    assert.equal((await request(url)).status, 403);
    const vite = { middlewares() { assert.fail("private files must not reach Vite"); } };
    assert.equal((await request(url, { vite })).status, 403);
  }
});
