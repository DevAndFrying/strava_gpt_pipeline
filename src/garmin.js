async function garminRequest(path = "", body) {
  const response = await fetch(`/api/garmin${path}`, body === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data) throw new Error(data?.message || `Garmin request failed (HTTP ${response.status}).`);
  return data;
}

export const fetchGarminState = () => garminRequest();
export const saveGarminKey = (apiKey) => garminRequest("/settings", { api_key: apiKey });
export const syncGarmin = (limit) => garminRequest("/sync", { limit });
