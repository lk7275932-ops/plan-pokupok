async(page)=>{
  const origin='http://127.0.0.1:4173',checks=[];const check=(v,n)=>{if(!v)throw Error(n);checks.push(n);};
  const ready=q=>q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor({timeout:20000});
  const control=async(data)=>{const response=await page.request.post(origin+'/_qa/control',{data});if(!response.ok())throw Error('QA control');};
  await control({reset:true});await control({scope:'/nested/',reset:true});
  for(const route of ['/','/index.html','/nested/','/nested/index.html']){
    const context=await page.context().browser().newContext();let q=await context.newPage();
    try{
      await q.goto(origin+route);await ready(q);
      const cached=await q.evaluate(async()=>{const names=await caches.keys(),cache=await caches.open(names[0]);return (await cache.keys()).map(k=>k.url);});
      check(cached.length===7,`Полный кэш: ${route}`);
      await q.locator('#create-trip').click();await q.locator('#save-trip').click();await q.locator('#add-name').fill('Хлеб');await q.locator('#add-form button[type=submit]').click();await q.locator('.item input').click();await q.locator('#add-name').fill('Молоко');await q.locator('#add-form button[type=submit]').click();
      const before=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));await q.close();await context.setOffline(true);q=await context.newPage();await q.goto(origin+route);await ready(q);
      check(await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===before&&await q.locator('.item.purchased').count()===1,`Закрытие и открытие без сети: ${route}`);
      await q.locator('#transfer-trip').click();await q.locator('#save-trip').click();await q.locator('[data-section=history]').click();check(await q.locator('.history-card').count()===1,`Перенос и история офлайн: ${route}`);
      await q.locator('[data-section=catalog]').click();await q.getByRole('button',{name:'Добавить в поход: Хлеб',exact:true}).click();await q.locator('#item-form button[type=submit]').click();await q.locator('#add-name').fill('Яблоки');await q.locator('#add-form button[type=submit]').click();check(await q.locator('.item').count()===3,`Каталог и добавление офлайн: ${route}`);
      check(await q.locator('#network-status').isVisible(),`Индикатор сети: ${route}`);await q.close();q=await context.newPage();await q.goto(origin+route);await ready(q);check(await q.locator('.item').count()===3,`Повторное офлайн-открытие: ${route}`);
    }finally{await context.close();}
  }
  const cold=await page.context().browser().newContext();try{await cold.setOffline(true);const q=await cold.newPage();let failed=false;try{await q.goto(origin);}catch{failed=true;}check(failed,'Первое посещение без сети не обещает готовность');}finally{await cold.close();}
  await control({fail:'icons/icon-512.png'});
  const failure=await page.context().browser().newContext();try{
    const q=await failure.newPage();await q.goto(origin);await q.locator('#retry-offline').waitFor({state:'visible',timeout:20000});check(await q.locator('#offline-status').textContent().then(t=>t.includes('Не удалось')),'Ошибка ресурса не даёт ложной готовности');check(await q.evaluate(async()=>!(await caches.keys()).some(k=>k.startsWith('shopping-planner-app-'))),'Неудачный кэш установки удалён');
    await q.evaluate(()=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.defineProperty(e,'prompt',{value:()=>{window.promptCalled=true;return Promise.resolve();}});Object.defineProperty(e,'userChoice',{value:Promise.resolve({outcome:'dismissed'})});dispatchEvent(e);});check(await q.locator('#install-app').isHidden(),'Событие установки до готовности не показывает кнопку');
    await control({reset:true});await q.locator('#retry-offline').click();await ready(q);check(true,'Повтор после восстановления ресурсов');check(await q.locator('#install-app').isVisible(),'Сохранённое событие доступно после подготовки');await q.locator('#install-app').click();check(await q.evaluate(()=>window.promptCalled===true),'Отложенный вызов установки только по нажатию');
    await q.evaluate(async()=>{const key=(await caches.keys()).find(k=>k.startsWith('shopping-planner-app-'));await (await caches.open(key)).delete(new URL('icons/icon-512.png',location.href));});await q.close();await failure.setOffline(true);const partial=await failure.newPage();await partial.goto(origin);await partial.locator('#retry-offline').waitFor({state:'visible'});check(await partial.locator('#offline-status').textContent().then(t=>t.includes('Не удалось')),'Неполный кэш не выдаётся за готовый');await failure.setOffline(false);await ready(partial);check(true,'Повтор подготовки восстанавливает неполный кэш');
  }finally{await failure.close();await control({reset:true});}
  const updates=await page.context().browser().newContext();let q=await updates.newPage();try{
    await q.goto(origin);await ready(q);await q.locator('#create-trip').click();await q.locator('#save-trip').click();await q.locator('#add-name').fill('Черновик');const old=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));
    await q.evaluate(async()=>{await caches.open('foreign-cache');await caches.open('shopping-planner-app-%2Fnested%2F-other');});
    await control({version:'v4',fail:'icons/icon-512.png'});await q.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});await q.waitForTimeout(1000);
    check(await q.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();return !!r.active&&!r.waiting&&(await caches.keys()).includes('shopping-planner-app-%2F-v3');}),'Сбой обновления сохраняет старую версию');
    await control({version:'v4',fail:null});await q.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await r.update();});await q.locator('#update-status').waitFor({state:'visible'});
    check(await q.locator('#add-name').inputValue()==='Черновик'&&await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===old,'Ожидающее обновление не прерывает ввод и не меняет данные');check(await q.evaluate(async()=>!!(await navigator.serviceWorker.getRegistration()).waiting),'Новая версия ждёт закрытия вкладок');
    await q.close();await new Promise(r=>setTimeout(r,300));q=await updates.newPage();await q.goto(origin);await ready(q);
    const names=await q.evaluate(()=>caches.keys());check(names.includes('shopping-planner-app-%2F-v4')&&!names.includes('shopping-planner-app-%2F-v3')&&names.includes('foreign-cache')&&names.includes('shopping-planner-app-%2Fnested%2F-other'),'Активация очищает только старый кэш этой папки');check(await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===old,'Данные сохраняются при обновлении');
    await updates.setOffline(true);await q.reload();await ready(q);check(await q.locator('#trip').isVisible(),'Обновлённая версия открывается офлайн');
  }finally{await updates.close();await control({reset:true});}
  return {passed:checks.length,checks};
}
