import { useEffect, useState } from "react";

/**
 * Service-worker update prompt (JSX, hence .tsx). Renders nothing until a new
 * SW is installed while an old one controls the page, then offers a reload.
 * WS5 wires the copy through i18n ("updateAvailable"/"reload" keys).
 */
export function SwUpdatePrompt() {
  const [updateReady, setUpdateReady] = useState(false);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    void navigator.serviceWorker.ready.then((reg) => {
      reg.addEventListener("updatefound", () => {
        const w = reg.installing;
        if (!w) return;
        w.addEventListener("statechange", () => {
          if (w.state === "installed" && navigator.serviceWorker.controller) {
            setUpdateReady(true);
          }
        });
      });
    });
  }, []);

  if (!updateReady) return null;

  return (
    <div
      className="fixed right-3 bottom-3 z-50 rounded-lg border border-slate-700 bg-slate-900 px-3 py-2 text-sm shadow-lg"
      role="status"
    >
      <button
        type="button"
        className="text-sky-400 underline"
        onClick={() => window.location.reload()}
      >
        Reload for update
      </button>
    </div>
  );
}
