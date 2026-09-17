/* Service worker — Inventário TON
   Estratégia:
   - API (/api/): sempre pela rede, nunca em cache.
   - Documento (index.html / navegação): NETWORK-FIRST — procura a versão nova
     quando há internet e recorre à cache só quando está offline. Assim, as
     atualizações da app aparecem sozinhas, sem ficar presa a uma versão antiga.
   - Restantes recursos estáticos (ícones, vendor): CACHE-FIRST (rápidos e offline). */
const CACHE = "inventario-ton-v2.7.1";
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
  if (url.pathname.includes("/api/")) return;        // API: nunca em cache
  if (e.request.method !== "GET") return;

  const ehDocumento = e.request.mode === "navigate"
    || url.pathname === "/" || url.pathname.endsWith("/index.html");

  if (ehDocumento) {
    // NETWORK-FIRST: rede quando disponível; cache como reserva (offline).
    e.respondWith(
      fetch(e.request).then(resp => {
        const clone = resp.clone();
        caches.open(CACHE).then(c => c.put("./index.html", clone));
        return resp;
      }).catch(() => caches.match("./index.html").then(r => r || caches.match(e.request)))
    );
    return;
  }

  // CACHE-FIRST para os restantes recursos estáticos.
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(r => r || fetch(e.request).then(resp => {
      const clone = resp.clone();
      caches.open(CACHE).then(c => c.put(e.request, clone));
      return resp;
    }).catch(() => caches.match("./index.html")))
  );
});
