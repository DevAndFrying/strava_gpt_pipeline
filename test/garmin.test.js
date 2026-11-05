const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { createGarminService } = require("../garmin.js");
const { zipSync } = require("fflate");

const token = (expires = Date.now() / 1000 + 3600) => `header.${Buffer.from(JSON.stringify({ exp: expires })).toString("base64url")}.signature`;
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });

async function fixture(t, fetchImpl, env = {}) {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "garmin-test-"));
  t.after(() => fs.rm(dataDir, { recursive: true, force: true }));
  return { dataDir, service: createGarminService({ dataDir, fetchImpl, env }) };
}

test("verifies a key, persists it privately, and never includes secrets in state", async (t) => {
  const calls = [];
  const { dataDir, service } = await fixture(t, async (url, options) => {
    calls.push({ url: String(url), options });
    return new Response(token());
  });
  assert.equal((await service.getState()).has_api_key, false);
  const state = await service.saveKey(" test-personal-key ");
  assert.equal(calls[0].url, "https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token");
  assert.equal(calls[0].options.method, "POST");
  assert.equal(calls[0].options.headers.Authorization, "ApiKey test-personal-key");
  assert.equal(state.has_api_key, true);
  assert.ok(!JSON.stringify(state).includes("test-personal-key"));
  const saved = path.join(dataDir, ".garmin-auth.json");
  assert.equal((await fs.stat(saved)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await fs.readFile(saved)).api_key, "test-personal-key");
  const restarted = createGarminService({ dataDir, env: {}, fetchImpl: () => assert.fail("state must not call Garmin") });
  assert.equal((await restarted.getState()).has_api_key, true);
});

test("sync paginates, imports details, caches tokens and updates IDs across syncs and restarts", async (t) => {
  let version = 1;
  let tokens = 0;
  const requests = [];
  const { dataDir, service } = await fixture(t, async (url, options) => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (options.method === "POST") { tokens += 1; return new Response(token()); }
    assert.match(options.headers.Authorization, /^Bearer header\./);
    if (parsed.pathname.includes("activitylist-service")) {
      const start = Number(parsed.searchParams.get("start"));
      // Exercise a short page followed by another page and then exhaustion.
      return json(start === 0 ? [{ activityId: 11, startTimeGMT: "2026-11-02 12:00:00" }] : start === 1 ? [{ activityId: 12 }] : []);
    }
    const id = Number(parsed.pathname.split("/").pop());
    return json({ activityId: id, activityName: `Run v${version}`, summaryDTO: { distance: 5000 + version } });
  }, { GARMIN_PERSONAL_API_KEY: "env-key" });
  const first = await service.sync(5);
  assert.equal(first.synced_count, 2);
  assert.equal(first.activities[0].startTimeGMT, "2026-11-02 12:00:00");
  assert.equal(first.activities[0].summaryDTO.distance, 5001);
  assert.ok(first.last_synced_at);
  assert.deepEqual(requests.filter((url) => url.pathname.includes("activitylist-service")).map((url) => url.searchParams.get("start")), ["0", "1", "2"]);
  version = 2;
  const second = await service.sync(1);
  assert.equal(second.activities.length, 2);
  assert.equal(second.activities[0].summaryDTO.distance, 5002);
  assert.equal(tokens, 1);
  assert.equal((await fs.stat(path.join(dataDir, ".garmin-activities.json"))).mode & 0o777, 0o600);
  const restarted = createGarminService({ dataDir, env: {}, fetchImpl: () => assert.fail("no network on state load") });
  assert.deepEqual((await restarted.getState()).activities, second.activities);
});

test("invalid keys and upstream errors preserve previous credentials and redact upstream messages", async (t) => {
  let fail = false;
  const { dataDir, service } = await fixture(t, async () => fail ? json({ message: "secret: rejected-key" }, 403) : new Response(token()));
  await service.saveKey("original-key");
  fail = true;
  await assert.rejects(service.saveKey("rejected-key"), (error) => error.statusCode === 403 && !error.message.includes("rejected-key"));
  assert.equal(JSON.parse(await fs.readFile(path.join(dataDir, ".garmin-auth.json"))).api_key, "original-key");
  await assert.rejects(service.saveKey("bad\nkey"), { statusCode: 400 });
  await assert.rejects(service.saveKey(""), { statusCode: 400 });
});

test("environment keys take precedence and cannot be silently replaced in the UI", async (t) => {
  const { dataDir, service } = await fixture(t, () => assert.fail("no network needed"), { GARMIN_PERSONAL_API_KEY: "env-key" });
  await fs.writeFile(path.join(dataDir, ".garmin-auth.json"), JSON.stringify({ api_key: "saved-key" }));
  assert.equal((await service.getState()).is_api_key_from_env, true);
  await assert.rejects(service.saveKey("replacement-key"), { statusCode: 409 });
});

test("missing keys, invalid limits, rate limits, invalid tokens, and network failures are actionable", async (t) => {
  const { service } = await fixture(t, () => assert.fail("no network without key"));
  await assert.rejects(service.sync(), { statusCode: 400 });
  for (const limit of [0, 51, 1.5, "10", null]) await assert.rejects(service.sync(limit), { statusCode: 400 });
  const limited = await fixture(t, async () => new Response("sensitive", { status: 429 }));
  await assert.rejects(limited.service.saveKey("key"), (error) => error.statusCode === 429 && /rate limit/.test(error.message));
  for (const value of ["not-a-token", token(0)]) {
    const invalid = await fixture(t, async () => new Response(value));
    await assert.rejects(invalid.service.saveKey("key"), /invalid|expired/);
  }
  const offline = await fixture(t, async () => { throw new Error("sensitive network details"); });
  await assert.rejects(offline.service.saveKey("key"), /Could not reach Garmin/);
});

test("refreshes a rejected bearer token once and uses the renewed token", async (t) => {
  let tokens = 0;
  let gets = 0;
  const { service } = await fixture(t, async (url, options) => {
    if (options.method === "POST") { tokens += 1; return new Response(token()); }
    gets += 1;
    return gets === 1 ? new Response("expired", { status: 401 }) : json([]);
  }, { GARMIN_PERSONAL_API_KEY: "key" });
  assert.equal((await service.sync(1)).synced_count, 0);
  assert.equal(tokens, 2);
  assert.equal(gets, 2);
});

test("failed imports retain saved activities and last sync time", async (t) => {
  let fail = false;
  const { service } = await fixture(t, async (url, options) => {
    if (options.method === "POST") return new Response(token());
    if (String(url).includes("activitylist-service")) return json([{ activityId: 1 }]);
    return fail ? new Response("error", { status: 500 }) : json({ activityId: 1, activityName: "Saved run" });
  }, { GARMIN_PERSONAL_API_KEY: "key" });
  const saved = await service.sync(1);
  fail = true;
  await assert.rejects(service.sync(1), { statusCode: 502 });
  assert.deepEqual(await service.getState(), {
    has_api_key: true, is_api_key_from_env: true,
    activities: saved.activities, last_synced_at: saved.last_synced_at,
  });
});

test("rejects simultaneous syncs", async (t) => {
  let finish;
  const { service } = await fixture(t, async (url, options) => {
    if (options.method === "POST") return new Response(token());
    return new Promise((resolve) => { finish = () => resolve(json([])); });
  }, { GARMIN_PERSONAL_API_KEY: "key" });
  const first = service.sync(1);
  await assert.rejects(service.sync(1), { statusCode: 409 });
  // Let asynchronous file/key/token operations reach the activity request.
  while (!finish) await new Promise((resolve) => setImmediate(resolve));
  finish();
  await first;
});

test("downloads the original FIT bytes from a ZIP using the Garmin ID and cached credentials", async (t) => {
  const fit = Buffer.from([12, 32, 1, 0, 4, 0, 0, 0, 46, 70, 73, 84, 0, 255, 128, 1]);
  let tokens = 0;
  const { service, dataDir } = await fixture(t, async (url, options) => {
    if (options.method === "POST") { tokens++; return new Response(token()); }
    assert.equal(String(url), "https://personal.connectapi.garmin.com/download-service/files/activity/123");
    assert.match(options.headers.Authorization, /^Bearer header\./);
    assert.equal(options.headers.Accept, "application/zip");
    return new Response(zipSync({ "nested/recording.FIT": fit, "notes.txt": Buffer.from("ignored") }));
  }, { GARMIN_PERSONAL_API_KEY: "download-key" });
  for (let attempt = 0; attempt < 2; attempt++) {
    const download = await service.downloadFit("123");
    assert.equal(download.filename, "garmin-123.fit");
    assert.deepEqual(download.content, fit);
  }
  assert.equal(tokens, 1);
  assert.deepEqual(await fs.readdir(dataDir), []);
});

test("FIT downloads renew rejected tokens and redact upstream errors", async (t) => {
  const fit = Buffer.from([12, 32, 1, 0, 0, 0, 0, 0, 46, 70, 73, 84]);
  let tokens = 0;
  let downloads = 0;
  let fail = false;
  const { service } = await fixture(t, async (url, options) => {
    if (options.method === "POST") { tokens++; return new Response(token()); }
    if (fail) return new Response("secret download-key", { status: 403 });
    downloads++;
    return downloads === 1 ? new Response("expired", { status: 401 }) : new Response(zipSync({ "run.fit": fit }));
  }, { GARMIN_PERSONAL_API_KEY: "download-key" });
  assert.deepEqual((await service.downloadFit(123)).content, fit);
  assert.equal(tokens, 2);
  assert.equal(downloads, 2);
  fail = true;
  await assert.rejects(service.downloadFit(123), (error) => error.statusCode === 403 && !error.message.includes("download-key"));
});

test("FIT downloads validate IDs and require credentials before contacting Garmin", async (t) => {
  const { service } = await fixture(t, () => assert.fail("no network expected"));
  for (const id of ["", "0", "-1", "1.5", "../123", "123?secret", null, undefined]) {
    await assert.rejects(service.downloadFit(id), { statusCode: 400 });
  }
  await assert.rejects(service.downloadFit(123), /Save a Garmin Connect Personal API key/);
});

test("FIT downloads report absent recordings and reject malformed archives or FIT contents", async (t) => {
  let archive = zipSync({ "activity.tcx": Buffer.from("not a FIT recording") });
  const { service } = await fixture(t, async (url, options) => {
    if (options.method === "POST") return new Response(token());
    return new Response(archive);
  }, { GARMIN_PERSONAL_API_KEY: "download-key" });
  await assert.rejects(service.downloadFit(123), (error) => error.statusCode === 404 && /no original FIT/.test(error.message));
  for (const value of [
    Buffer.alloc(0),
    Buffer.from("not a ZIP"),
    zipSync({ "run.fit": Buffer.from("not a FIT") }),
    zipSync({ "run.fit": Buffer.alloc(12) }),
    zipSync({ "one.fit": Buffer.alloc(12), "two.fit": Buffer.alloc(12) }),
  ]) {
    archive = value;
    await assert.rejects(service.downloadFit(123), { statusCode: 502 });
  }
});
