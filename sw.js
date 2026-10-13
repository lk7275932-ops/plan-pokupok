'use strict';
// При выпуске: обновить хэши (node tests/update-cache-hashes.cjs) и VERSION.
// Старые вкладки завершают работу сами; skipWaiting намеренно не используется.
const VERSION='v3';
const HASHES={"index.html":"9634ab2245ec311e80a83b2892d02cb08e706c41f88a25e05e250a93c6187b6b","style.css":"cdf082ca1ba2c08c48036fbbf3bb0b89c490dd7ec125d7300997d14fa880444c","script.js":"5d66d1e0cc03bee53e89a807764b46b7250efbb4cabed42a3db901ea5b15d702","manifest.webmanifest":"63e711c5a76ba9a56ecb785d8d00017a127bb1878fbdffb64d2110fd64fc1734","icons/icon-192.png":"6b4f66528fdf77ded113904a2f5cce416e9730fd4cfee7b2915e15db889345ea","icons/icon-512.png":"99c93c1a37e1b724d5bfd79d449f7a32449694ea2ad68035e25a9bfab13c40b9"}; // SHA-256 каждого файла; обновляется инструментом выпуска.
const BASE=new URL('./',self.location.href);
const PREFIX='shopping-planner-app-'+encodeURIComponent(BASE.pathname)+'-';
const CACHE=PREFIX+VERSION;
const FILES=['index.html','style.css','script.js','manifest.webmanifest','icons/icon-192.png','icons/icon-512.png'].map(file=>new URL(file,BASE).href);
async function announce(type){
  const clients=await self.clients.matchAll();
  clients.forEach(client=>client.postMessage({type}));
}
async function verified(response,url){
  const canonical=new URL(url);canonical.search='';canonical.hash='';
  const name=canonical.href===BASE.href?'index.html':canonical.href.slice(BASE.href.length);
  if(!HASHES[name])return true;
  const bytes=await response.clone().arrayBuffer();
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  const hash=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
  if(hash===HASHES[name])return true;
  await announce('VERSION_MISMATCH');return false;
}
async function cacheableResponse(response){
  if(!response.redirected)return response;
  // Навигация из кэша не принимает ответ с redirected=true. Сохраняем проверенное содержимое.
  const headers=new Headers(response.headers);headers.delete('content-encoding');headers.delete('content-length');
  return new Response(await response.arrayBuffer(),{status:response.status,statusText:response.statusText,headers});
}
async function prepareFiles(){
  // Сначала загрузить и проверить весь комплект, затем записывать в свой кэш.
  const responses=await Promise.all(FILES.map(async url=>{
    const response=await fetch(new Request(url,{cache:'reload'}));
    if(!response.ok||!await verified(response,url))throw Error('Несовместимый или недоступный файл');
    return cacheableResponse(response);
  }));
  const cache=await caches.open(CACHE);
  for(let i=0;i<FILES.length;i++)await cache.put(FILES[i],responses[i].clone());
  await cache.put(BASE.href,responses[0]);
}
async function completeCache(){
  const cache=await caches.open(CACHE);
  const responses=await Promise.all([...FILES,BASE.href].map(url=>cache.match(url)));
  return responses.every(response=>response?.ok);
}
self.addEventListener('install',event=>event.waitUntil(prepareFiles().catch(async error=>{await caches.delete(CACHE);throw error;})));
self.addEventListener('activate',event=>event.waitUntil((async()=>{
  const keys=await caches.keys();await Promise.all(keys.filter(key=>key.startsWith(PREFIX)&&key!==CACHE).map(key=>caches.delete(key)));
  await self.clients.claim();
})()));
self.addEventListener('message',event=>{
  if(!['CHECK_OFFLINE','PREPARE_OFFLINE'].includes(event.data?.type))return;
  event.waitUntil((async()=>{
    try{if(event.data.type==='PREPARE_OFFLINE')await prepareFiles();event.ports[0]?.postMessage({ready:await completeCache(),version:VERSION});}
    catch{event.ports[0]?.postMessage({ready:false,version:VERSION});}
  })());
});
self.addEventListener('fetch',event=>{
  const url=new URL(event.request.url);
  if(event.request.method!=='GET'||url.origin!==BASE.origin||!url.href.startsWith(BASE.href)||url.pathname===new URL('sw.js',BASE).pathname)return;
  event.respondWith((async()=>{
    let cache;
    try{cache=await caches.open(CACHE);const cached=await cache.match(event.request);if(cached)return cacheableResponse(cached);}
    catch{await announce('OFFLINE_UNAVAILABLE');}
    try{
      const response=await fetch(event.request);
      if(response.ok){
        if(!await verified(response,url.href))return new Response('Обновление приложения: закройте все вкладки планировщика и откройте его снова.',{status:503,headers:{'Content-Type':'text/plain; charset=utf-8'}});
        // Отказ кэша не должен уничтожать успешно загруженный сетевой ответ.
        try{if(cache)await cache.put(event.request,await cacheableResponse(response.clone()));}catch{await announce('OFFLINE_UNAVAILABLE');}
      }
      return response;
    }catch(error){
      if(event.request.mode==='navigate'&&cache){try{const index=await cache.match(FILES[0]);if(index)return cacheableResponse(index);}catch{}}
      throw error;
    }
  })());
});
