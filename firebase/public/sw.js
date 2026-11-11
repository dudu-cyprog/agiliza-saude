// =====================================================================
// Service worker do Agiliza Saúde (permite "instalar" o site como aplicativo).
// Estratégia "rede primeiro": sempre busca a versão nova; sem internet,
// mostra a última cópia salva das páginas. Dados (Firebase) nunca são guardados aqui.
// =====================================================================
const CACHE = 'agiliza-v1';
const ARQUIVOS = [
  '/', '/index.html', '/painel.html',
  '/js/comum.js', '/js/site.js', '/js/painel.js', '/js/firebase-init.js',
  '/img/logo.svg', '/img/icone-192.png', '/manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ARQUIVOS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((nomes) => Promise.all(nomes.filter((n) => n !== CACHE).map((n) => caches.delete(n))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  // só os arquivos do próprio site; Firebase, CDNs etc. passam direto
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(
    fetch(e.request)
      .then((resp) => {
        if (resp.ok) {
          const copia = resp.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copia));
        }
        return resp;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }))
  );
});
