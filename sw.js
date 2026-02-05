// Service Worker for Hours Worked Tracker
const CACHE_NAME = 'hours-tracker-v1';
const ASSETS_TO_CACHE = [
    '/hours-worked-tracker/',
    '/hours-worked-tracker/index.html',
    '/hours-worked-tracker/css/styles.css',
    '/hours-worked-tracker/js/config.js',
    '/hours-worked-tracker/js/firebase-auth.js',
    '/hours-worked-tracker/js/sheets-api.js',
    '/hours-worked-tracker/js/tax-calc.js',
    '/hours-worked-tracker/js/pipeline.js',
    '/hours-worked-tracker/js/goals.js',
    '/hours-worked-tracker/js/app.js',
    '/hours-worked-tracker/icons/icon-192.svg',
    '/hours-worked-tracker/icons/icon-512.svg',
    '/hours-worked-tracker/manifest.json'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME)
            .then((cache) => {
                console.log('Caching app assets');
                return cache.addAll(ASSETS_TO_CACHE);
            })
            .then(() => self.skipWaiting())
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((cacheNames) => {
                return Promise.all(
                    cacheNames
                        .filter((name) => name !== CACHE_NAME)
                        .map((name) => caches.delete(name))
                );
            })
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    if (event.request.method !== 'GET') return;
    if (event.request.url.includes('script.google.com')) return;
    if (event.request.url.includes('cdn.tailwindcss.com') ||
        event.request.url.includes('fonts.googleapis.com') ||
        event.request.url.includes('fonts.gstatic.com') ||
        event.request.url.includes('unpkg.com')) {
        return;
    }

    event.respondWith(
        fetch(event.request)
            .then((response) => {
                const responseClone = response.clone();
                caches.open(CACHE_NAME)
                    .then((cache) => cache.put(event.request, responseClone));
                return response;
            })
            .catch(() => {
                return caches.match(event.request)
                    .then((cachedResponse) => {
                        if (cachedResponse) return cachedResponse;
                        if (event.request.mode === 'navigate') {
                            return caches.match('/hours-worked-tracker/index.html');
                        }
                        return new Response('Offline', { status: 503 });
                    });
            })
    );
});
