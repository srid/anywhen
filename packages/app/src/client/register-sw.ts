// Service worker registration. Runs after the app mounts so the initial
// paint isn't blocked. Service workers only register over HTTPS (or
// localhost), so plain-HTTP non-localhost dev servers silently no-op.

export const registerServiceWorker = (): void => {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.warn("[sw] registration failed", err);
    });
  });
};
