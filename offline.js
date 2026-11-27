// The module worker also updates when the public project configuration changes.
import { allowRegistration, turnstileSiteKey } from './js/account-config.js';
import { projectUrl, publishableKey } from './js/cloud-config.js';
// Public app files only. Scope-qualified cache names also isolate other Pages projects on this origin.
const scope = self.registration.scope;
const cachePrefix = 'aftercredits-shell:' + scope + ':';
const cacheName =
  cachePrefix +
  '4a.1-accounts.1:' +
  projectUrl +
  ':' +
  publishableKey +
  ':' +
  allowRegistration +
  ':' +
  turnstileSiteKey;
const paths = [
  './',
  './index.html',
  './css/site.css',
  './css/street.css',
  './css/exhibition.css',
  './css/dialogs.css',
  './css/vault.css',
  './css/discovery.css',
  './css/account.css',
  ...[
    'app',
    'account-config',
    'download',
    'backup',
    'catalog',
    'cloud-config',
    'collection',
    'discovery',
    'discovery-preferences',
    'discovery-controls',
    'library',
    'config',
    'filmstrip',
    'import-plan',
    'motion',
    'picker',
    'stage',
    'validation',
    'vault',
    'vault-status',
    'vault-store',
    'views',
    'cloud/auth',
    'cloud/account-forms',
    'cloud/captcha',
    'cloud/guest-import',
    'cloud/cache',
    'cloud/local',
    'cloud/panel',
    'cloud/scope',
    'cloud/sync',
  ].map((name) => './js/' + name + '.js'),
  './assets/brand/aftercredits.svg',
];
const allowed = new Set(paths.map((path) => new URL(path, scope).href));
self.addEventListener('install', (event) =>
  event.waitUntil(
    (async () => {
      const cache = await caches.open(cacheName);
      await cache.addAll(
        [...allowed].map((url) => new Request(url, { cache: 'reload', credentials: 'omit' }))
      );
    })()
  )
);
self.addEventListener('activate', (event) =>
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys())
        if (key.startsWith(cachePrefix) && key !== cacheName) await caches.delete(key);
      await self.clients.claim();
    })()
  )
);
const scenery = new Set(
  [
    'vendor/gsap.min.js',
    'images/grain.png',
    'tmdb.svg',
    'brand/splice-tab-v1.svg',
    'brand/splice-tab-v1-32.png',
    ...[
      'plaza',
      'plaza-portrait',
      'plaza-portrait-compact',
      'glass-film',
      'glass-film-compact',
      'hydrangea',
      'camera-print',
    ].map((name) => 'images/street/' + name + '.webp'),
    ...[
      'instrument-serif-latin-400-italic',
      'instrument-serif-latin-400-normal',
      'ibm-plex-mono-latin-400-normal',
      ...[400, 500, 600, 700].map((weight) => 'dm-sans-latin-' + weight + '-normal'),
    ].map((name) => 'fonts/' + name + '.woff2'),
  ].map((path) => new URL('assets/' + path, scope).href)
);
async function publicAsset(url, cache) {
  const stored = await cache.match(url);
  if (stored) return stored;
  const response = await fetch(url, { credentials: 'omit', redirect: 'error' });
  if (response.ok) await cache.put(url, response.clone()).catch(() => {});
  return response;
}
self.addEventListener('message', (event) => {
  if (event.data?.type !== 'warm-scenery' || !Array.isArray(event.data.urls)) return;
  const urls = [...new Set(event.data.urls.filter((url) => scenery.has(url)))];
  event.waitUntil(
    caches
      .open(cacheName)
      .then((cache) => Promise.allSettled(urls.map((url) => publicAsset(url, cache))))
  );
});
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = event.request.url;
  if (!allowed.has(url) && !scenery.has(url)) return;
  event.respondWith(caches.open(cacheName).then((cache) => publicAsset(url, cache)));
});
