async(page)=>{
  const url='https://shopping-planner-mobile-check.awake-teal-2910.chatgpt.site',checks=[];
  const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
  const context=await page.context().browser().newContext({viewport:{width:393,height:851},isMobile:true,hasTouch:true});let q=await context.newPage();
  const ready=async()=>{for(let attempt=0;attempt<3;attempt++){
    await q.waitForFunction(()=>/Готово|Не удалось/.test(document.querySelector('#offline-status').textContent),null,{timeout:20000});
    if((await q.locator('#offline-status').textContent()).includes('Готово'))return;
    await q.locator('#retry-offline').click();
  }throw Error('Опубликованный офлайн-кэш не подготовлен');};
  try{
    await q.goto(url);await ready();
    check(await q.evaluate(async()=>{const key=(await caches.keys()).find(k=>k.startsWith('shopping-planner-app-'));const cache=await caches.open(key);const requests=await cache.keys();return requests.length===7&&(await Promise.all(requests.map(r=>cache.match(r)))).every(r=>!r.redirected);}), 'Опубликованный кэш полный и без redirected');
    await q.locator('#create-trip').click();await q.locator('#save-trip').click();await q.locator('#add-name').fill('Проверка опубликованного приложения');await q.locator('#add-form button[type=submit]').click();const before=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));
    await context.setOffline(true);await q.reload();check(await q.locator('.item').count()===1,'Опубликованная страница перезагружается без сети');
    for(const path of ['/','/index.html']){await q.close();q=await context.newPage();await q.goto(url+path);await ready();check(await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===before&&await q.locator('.item').count()===1,'Повторное открытие опубликованного URL без сети: '+path);}
    await q.locator('#add-name').fill('Добавлено без интернета');await q.locator('#add-form button[type=submit]').click();check(await q.locator('.item').count()===2,'Добавление на опубликованном сайте без сети');
    return {passed:checks.length,checks};
  }finally{await context.close();}
}
