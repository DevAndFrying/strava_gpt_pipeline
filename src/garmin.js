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

export async function downloadGarminFit(activityId) {
  const response = await fetch(`/api/garmin/activities/${encodeURIComponent(activityId)}/fit`);
  if (!response.ok) {
    const data = await response.json().catch(() => null);
    throw new Error(data?.message || `FIT download failed (HTTP ${response.status}).`);
  }
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = `garmin-${activityId}.fit`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Allow the browser to start reading the blob before releasing it.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
