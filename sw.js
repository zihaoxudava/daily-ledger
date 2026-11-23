'use strict';

const prefix = 'daily-ledger-shell-';
const cacheName = prefix + '1.1.1';
const base = new URL(self.registration.scope);
const assets = [
  ['./','text/html'], ['./style.css','text/css'], ['./app.js','javascript'],
  ['./catalog.js','javascript'], ['./store.js','javascript'], ['./schedule.js','javascript'],
  ['./files.js','javascript'], ['./views.js','javascript'], ['./manifest.webmanifest','json'],
  ['./apple-touch-icon.png','image/png'], ['./icon-192.png','image/png'], ['./icon-512.png','image/png'],
  ['./guide/','text/html'],
].map(([path,type]) => [new URL(path,base).href,type]);
const known = new Set(assets.map(([url])=>url));

self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(cacheName);
    try {
      for (const [url,type] of assets) {
        const response = await fetch(url,{cache:'reload',credentials:'same-origin',redirect:'error'});
        const mime = response.headers.get('content-type') ?? '';
        if (!response.ok || !mime.includes(type)) throw new Error('Offline asset unavailable: ' + url);
        await cache.put(url,response);
      }
      await self.skipWaiting();
    } catch (error) {
      await caches.delete(cacheName);
      throw error;
    }
  })());
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const name of await caches.keys()) {
      if (name.startsWith(prefix) && name!==cacheName) await caches.delete(name);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  if (event.request.method!=='GET') return;
  const asset = new URL(event.request.url);
  asset.hash='';
  if (!known.has(asset.href)) return;
  event.respondWith(caches.open(cacheName).then(async cache => (await cache.match(asset.href,{ignoreVary:true})) ?? fetch(event.request)));
});
