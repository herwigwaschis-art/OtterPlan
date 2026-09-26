const CACHE="milo-v40";
const STATIC=["./","./?menu=1","./index.html","./manifest.webmanifest","./milo-icon.svg","./milo-icon.svg?v=40","./milo-icon-180.png","./milo-icon-192.png","./milo-icon-512.png","./milo-wordmark.svg"];
const LIBRARIES=new Set([
  "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2",
  "https://unpkg.com/html5-qrcode@2.3.8/html5-qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/qrcodejs@1.0.0/qrcode.min.js",
  "https://cdn.jsdelivr.net/npm/jspdf@2.5.2/dist/jspdf.umd.min.js"
]);

self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE).then(async cache=>{
    await cache.addAll(STATIC);
    await Promise.allSettled([...LIBRARIES].map(async url=>{
      const response=await fetch(url,{mode:"no-cors"});
      if(response.ok||response.type==="opaque")await cache.put(url,response);
    }));
  }).then(()=>self.skipWaiting()));
});

self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim()));
});

self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  const local=url.origin===self.location.origin;
  if(!local&&!LIBRARIES.has(url.href))return;
  event.respondWith(
    fetch(event.request,local?{cache:"no-store"}:undefined)
      .then(response=>{
        if(response.ok||(!local&&response.type==="opaque")){
          const copy=response.clone();
          event.waitUntil(caches.open(CACHE).then(cache=>cache.put(event.request,copy)));
        }
        return response;
      })
      .catch(()=>caches.match(event.request).then(response=>response||(local?caches.match("./index.html"):Response.error())))
  );
});
