/* Service worker — Inventário TON v2.0
   Estratégia: app shell em cache (funciona offline); API sempre pela rede. */
const CACHE = "inventario-ton-v2.6.0";
const SHELL = [
  "./", "./index.html", "./manifest.json",
  "./img/icone-192.png", "./img/icone-512.png", "./img/logo.png",
  "./vendor/jsQR.js", "./vendor/qrcode.js", "./vendor/exceljs.min.js",
  "./vendor/jspdf.umd.min.js", "./vendor/jspdf.plugin.autotable.min.js"
];
self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const url = new URL(e.request.url);
  if (url.pathname.includes("/api/")) return; // API: nunca em cache
  if (e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }).catch(() => caches.match("./index.html")))
  );
});
