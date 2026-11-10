/* 离线缓存：断网时还能打开，但**一律先走网络，失败再回缓存**。
 * 为什么不缓存优先：题库是会变的（加章、改题、修错），缓存优先会让页面一直拿旧数据，
 * 而且 `?v=` 版本号对 SW 缓存无效——它按 URL 命中，不知道版本号。
 * 只在 HTTPS / localhost 下可用，手机走局域网 HTTP 时没有 SW，离线靠 quiz-offline.html。
 */
const CACHE = 'quiz-cache-v3';
const CORE = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './srs.js',
  './manifest.webmanifest',
  './data/index.json',   // 各章 chNN.json 由下面的 fetch 钩子在访问后缓存
  './icon.svg'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      await Promise.all(CORE.map((url) => cache.add(url).catch(() => null)));
      await self.skipWaiting();
    })
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(async (keys) => {
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.includes('/api/')) return;   // 同步接口永远走网络

  event.respondWith((async () => {
    try {
      const res = await fetch(req);
      if (res && res.status === 200) {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(req, copy)).catch(() => {});
      }
      return res;
    } catch (err) {
      const cached = await caches.match(req);
      if (cached) return cached;
      if (req.mode === 'navigate') {
        const page = (await caches.match('./index.html')) || (await caches.match('./'));
        if (page) return page;
      }
      throw err;
    }
  })());
});