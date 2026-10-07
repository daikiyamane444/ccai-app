// CCAI Service Worker：何もキャッシュしない。ログイン後の画面・API応答を保存しないため（SPEC-000a AC-17）。
// fetch は横取りせず、すべてネットワークに任せる。過去に作られたキャッシュがあれば消す。
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await self.caches.keys()) await self.caches.delete(key);
      await self.clients.claim();
    })(),
  );
});
