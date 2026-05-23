// PWA bootstrap: inject the link tags that point at root-absolute asset
// URLs, then register the service worker. The link tags live here (not in
// index.html) because Bun.build's HTML handler tries to resolve absolute
// `href` paths at bundle time; injecting them at runtime sidesteps that,
// and both Chrome (manifest discovery) and Safari (apple-touch-icon) scan
// the DOM dynamically so install criteria are satisfied either way.

type LinkSpec = {
  rel: string;
  href: string;
  type?: string;
};

const PWA_LINKS: readonly LinkSpec[] = [
  { rel: "manifest", href: "/manifest.webmanifest" },
  { rel: "icon", href: "/icon.svg", type: "image/svg+xml" },
  { rel: "apple-touch-icon", href: "/icon.svg" },
];

const injectPwaLinks = (): void => {
  for (const spec of PWA_LINKS) {
    if (document.head.querySelector(`link[rel="${spec.rel}"][href="${spec.href}"]`)) continue;
    const link = document.createElement("link");
    link.rel = spec.rel;
    link.href = spec.href;
    if (spec.type) link.type = spec.type;
    document.head.appendChild(link);
  }
};

const registerServiceWorker = (): void => {
  if (!("serviceWorker" in navigator)) return;
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch((err) => {
      console.warn("[sw] registration failed", err);
    });
  });
};

export const setupPwa = (): void => {
  injectPwaLinks();
  registerServiceWorker();
};
