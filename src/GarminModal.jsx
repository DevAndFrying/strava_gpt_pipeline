import { useEffect, useRef, useState } from "react";
import { formatDate } from "./strava.js";
import { saveGarminKey, syncGarmin } from "./garmin.js";

function display(value, unit = "") {
  if (value === null || value === undefined) return "Unavailable";
  const rendered = typeof value === "number" ? Number(value.toFixed(3)) : value;
  return `${rendered}${unit ? ` ${unit}` : ""}`;
}

export default function GarminModal({ isOpen, onClose, state, onStateChange, limit, onLimitChange, comparison, comparisonScope, error }) {
  const dialogRef = useRef(null);
  const [apiKey, setApiKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [actionError, setActionError] = useState("");

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!isOpen) {
      setApiKey("");
      return;
    }

    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      dialog.close();
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  async function run(action) {
    if (busy) return;
    setBusy(true);
    setMessage("");
    setActionError("");
    try {
      await action();
    } catch (error) {
      setActionError(error.message);
    } finally {
      setBusy(false);
    }
  }

  function handleSave(event) {
    event.preventDefault();
    run(async () => {
      const nextState = await saveGarminKey(apiKey.trim());
      setApiKey("");
      onStateChange(nextState);
      setMessage("Garmin key verified and saved. You can sync activities now.");
    });
  }

  function handleSync() {
    run(async () => {
      const nextState = await syncGarmin(Math.min(Math.max(Number(limit) || 10, 1), 50));
      onStateChange(nextState);
      setMessage(`Synced ${nextState.synced_count} Garmin activities.`);
    });
  }

  return (
    <dialog
      ref={dialogRef}
      className="modal-panel garmin-modal"
      aria-labelledby="garmin-title"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (event.clientX < bounds.left || event.clientX > bounds.right ||
            event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
      }}
    >
      <div className="modal-heading">
        <h2 id="garmin-title">Garmin Connect sync & comparison</h2>
        <button type="button" className="icon-button" aria-label="Close Garmin" onClick={onClose} autoFocus>
          ×
        </button>
      </div>
      <p className="note">
        Create a <a href="https://connect.garmin.com/app/settings/personalApiToken" target="_blank" rel="noreferrer">Personal API key in Garmin Connect</a>,
        then save it here. Your key stays on the local server after saving.
      </p>
      <form className="garmin-controls" onSubmit={handleSave}>
        <label>
          Garmin Personal API key
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={busy || state?.is_api_key_from_env}
            placeholder={state?.has_api_key ? "Key configured; enter a new key to replace it" : "Paste your Personal API key"}
          />
        </label>
        <button type="submit" className="secondary" disabled={busy || !apiKey.trim() || state?.is_api_key_from_env}>
          Save Garmin key
        </button>
        <button type="button" disabled={busy || !state?.has_api_key} onClick={handleSync}>
          {busy ? "Working..." : "Sync Garmin"}
        </button>
      </form>
      <div className="garmin-sync-limit">
        <label>
          Activities to sync
          <input
            type="number"
            min="1"
            max="50"
            step="1"
            value={limit}
            onChange={(event) => onLimitChange(event.target.value)}
            disabled={busy}
          />
        </label>
      </div>
      <p className="note">
        {state?.is_api_key_from_env ? "Key configured through the server environment. " : state?.has_api_key ? "Key configured. " : "No Garmin key configured. "}
        Sync imports up to {Math.min(Math.max(Number(limit) || 10, 1), 50)} recent activities.
        {state?.last_synced_at ? ` Last synced ${formatDate(state.last_synced_at)}.` : ""}
      </p>
      {(actionError || error) && <p className="garmin-error" role="alert">{actionError || error}</p>}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Contacting Garmin and loading activity details...</p>}
      <p className="note">
        Matches use UTC start times within five minutes (including exactly five minutes).
        The closest pair is matched first; each entry is used once. Differences are Garmin minus Strava.
        Fetch or pull Strava activities to compare their detailed metrics. Imported activities and comparisons are included in Copy JSON.
      </p>
      <p>
        {comparison.garmin.length} Garmin activities imported · {comparison.pairs.length} matched · {comparison.unmatched_garmin_ids.length} Garmin entries without a match
      </p>
      <p className="note">Comparing against {comparison.strava.length} {comparisonScope}.</p>
      {comparison.pairs.map((pair) => {
        const strava = comparison.strava.find((activity) => activity.id === pair.strava_id);
        const changedCount = pair.fields.filter((field) => field.status === "different").length;
        return (
          <details className="garmin-comparison" key={`${pair.strava_id}-${pair.garmin_id}`}>
            <summary>
              {strava.name || "Untitled activity"} · {Math.abs(pair.start_difference_seconds)} s apart · {changedCount} differing fields
            </summary>
            <p className="note">Strava ID {pair.strava_id} · Garmin ID {pair.garmin_id}</p>
            <div className="mini-table-section">
              <table>
                <caption>Comparison for {strava.name || pair.strava_id}</caption>
                <thead><tr><th scope="col">Metric</th><th scope="col">Strava</th><th scope="col">Garmin</th><th scope="col">Difference (Garmin − Strava)</th></tr></thead>
                <tbody>
                  {pair.fields.filter((field) => field.strava !== null || field.garmin !== null).map((field) => (
                    <tr key={field.field} className={field.status === "different" ? "garmin-different" : ""}>
                      <th scope="row">{field.label}</th>
                      <td>{display(field.strava, field.unit)}</td>
                      <td>{display(field.garmin, field.unit)}</td>
                      <td>{field.delta !== null
                        ? `${field.delta > 0 ? "+" : ""}${display(field.delta, field.unit)}`
                        : field.status === "same" ? "Same" : field.status === "missing" ? "Unavailable" : "Different"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        );
      })}
      {comparison.garmin.length > 0 && (
        <details className="garmin-comparison">
          <summary>Imported Garmin activities</summary>
          <ul className="garmin-imports">
            {[...comparison.garmin].sort((a, b) => (Date.parse(b.started_at) || 0) - (Date.parse(a.started_at) || 0)).map((activity) => (
              <li key={activity.id}>
                <strong>{activity.name || "Untitled activity"}</strong> · ID {activity.id} · {activity.sport_type || "Activity"}
                {activity.started_at ? ` · ${formatDate(activity.started_at)}` : " · UTC start unavailable"}
                {` · ${display(activity.distance_meters, "m")}`}
                {comparison.unmatched_garmin_ids.includes(activity.id) ? " · No Strava match" : " · Matched"}
              </li>
            ))}
          </ul>
        </details>
      )}
    </dialog>
  );
}
