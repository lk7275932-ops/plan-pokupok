async(page)=>{
  const checks=[];const check=(v,n)=>{if(!v)throw Error(n);checks.push(n);};
  for(const mode of ['standalone','unsupported','no-js','file']){
    const context=await page.context().browser().newContext({javaScriptEnabled:mode!=='no-js',viewport:{width:320,height:812}});
    try{
      if(mode==='standalone')await context.addInitScript(()=>{const original=matchMedia.bind(window);window.matchMedia=q=>q==='(display-mode: standalone)'?{matches:true,addEventListener(){}}:original(q);});
      if(mode==='unsupported')await context.addInitScript(()=>delete Navigator.prototype.serviceWorker);
      const q=await context.newPage();await q.goto(mode==='file'?'file:///C:/Users/User/Documents/ChatGPT/Планировщик покупок/index.html':'http://127.0.0.1:4173');
      if(mode==='standalone'){await q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor();check(await q.locator('#install-help').isHidden()&&await q.locator('#install-app').isHidden(),'Standalone не предлагает установку');}
      if(mode==='unsupported')check(await q.locator('#offline-status').textContent().then(t=>t.includes('недоступен'))&&await q.locator('#retry-offline').isHidden(),'Без API доступен онлайн-интерфейс с пояснением');
      if(mode==='no-js')check(await q.locator('noscript').textContent().then(t=>t.includes('включите JavaScript')),'Понятное сообщение без JavaScript');
      if(mode==='file')check(await q.locator('#file-notice').isVisible()&&await q.locator('#offline-status').textContent().then(t=>t.includes('HTTPS')),'file:// объясняет ограничение офлайн-режима');
      check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`Нет горизонтального скролла: ${mode}`);
    }finally{await context.close();}
  }
  return {passed:checks.length,checks};
}
