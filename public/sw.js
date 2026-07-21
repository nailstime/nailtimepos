const CACHE_NAME = 'nailtime-pos-shell-v2'
const APP_SHELL = [
  '/',
  '/index.html',
  '/display.html',
  '/manifest.webmanifest',
  '/display-manifest.webmanifest',
  '/icons/nailtime-mark.svg',
  '/icons/nailtime-mark-maskable.svg',
]

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)))
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key.startsWith('nailtime-pos-') && key !== CACHE_NAME)
        .map((key) => caches.delete(key)),
    )),
  )
  self.clients.claim()
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  const url = new URL(request.url)

  if (request.method !== 'GET' || url.origin !== self.location.origin) return

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => response)
        .catch(() => caches.match('/index.html')),
    )
    return
  }

  if (!url.pathname.startsWith('/assets/') && !url.pathname.startsWith('/icons/') && !url.pathname.endsWith('-manifest.webmanifest')) return

  event.respondWith(
    caches.match(request).then((cached) => cached || fetch(request).then((response) => {
      if (response.ok) {
        const copy = response.clone()
        caches.open(CACHE_NAME).then((cache) => cache.put(request, copy))
      }
      return response
    })),
  )
})
