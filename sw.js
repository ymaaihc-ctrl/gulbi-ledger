// 앱 파일을 캐시해 오프라인에서도 열리게 한다. 사용자 데이터는 IndexedDB에 있어 캐시와 무관하다.
const CACHE = 'gulbi-v1';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'calc.js', 'db.js', 'mascot.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-180.png', 'icons/icon-192.png', 'icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

// 앱 파일: 네트워크 우선(업데이트 반영), 실패하면 캐시. 글꼴 등 외부 파일: 캐시 우선.
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
  } else if (url.hostname.endsWith('gstatic.com') || url.hostname.endsWith('googleapis.com')) {
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    })));
  }
});
