async(page)=>{
  const origin='http://127.0.0.1:4173',KEY='shopping-planner.state.v1',checks=[];
  const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
  const control=async data=>{await page.request.post(origin+'/_qa/control',{data});};
  const ready=q=>q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor({timeout:20000});
  const create=async q=>{await q.locator('#create-trip').click();await q.locator('#save-trip').click();};
  const add=async(q,name)=>{await q.locator('#add-name').fill(name);await q.locator('#add-form button[type=submit]').click();};
  await control({reset:true});
  const forms=await page.context().browser().newContext();try{
    const q=await forms.newPage();await q.goto(origin);await ready(q);await create(q);
    for(const [filter,text] of [['remaining','Всё куплено'],['purchased','Пока ничего не куплено'],['all','Добавьте первую покупку']]){
      await q.locator(`[data-filter=${filter}]`).click();check(await q.locator('#list-empty').textContent()===text,'Пустой фильтр: '+filter);
    }
    check(await q.locator('.field-error').evaluateAll(nodes=>nodes.length===6&&nodes.every(n=>n.getAttribute('aria-live')==='polite'&&n.getAttribute('aria-atomic')==='true')),'Все ошибки полей объявляются через live region');
    await q.locator('#add-form button[type=submit]').click();check(await q.locator('#add-name').getAttribute('aria-invalid')==='true'&&await q.locator('#add-name-error').textContent().then(Boolean),'Ошибка связана с полем и содержит текст');
    await add(q,'Хлеб');await add(q,'Булка');const before=await q.evaluate(key=>localStorage.getItem(key),KEY);
    await q.locator('.item .edit').first().click();await q.locator('#edit-name').fill('Булка');await q.locator('#edit-quantity').fill('2,5');await q.locator('#item-form button[type=submit]').click();
    await q.evaluate(key=>{const set=Storage.prototype.setItem;window.restoreSet=()=>{Storage.prototype.setItem=set;};Storage.prototype.setItem=function(k,v){if(k===key)throw new DOMException('quota','QuotaExceededError');return set.call(this,k,v);};},KEY);
    await q.locator('#confirm-ok').click();check(await q.locator('#confirm-dialog .dialog-error').isVisible()&&await q.evaluate(key=>localStorage.getItem(key),KEY)===before,'Неудачное объединение сохраняет исходные данные');
    await q.locator('#confirm-dialog .dialog-cleanup button').first().click();check(await q.locator('dialog[open]').count()===0&&await q.locator('#history-section').isVisible(),'Очистка закрывает всю цепочку окон');
    await q.locator('[data-section=catalog]').click();check(await q.locator('#catalog-section').isVisible(),'После ошибки интерфейс доступен для нажатий');
    await q.evaluate(()=>restoreSet());await q.locator('#resume-draft').click();check(await q.locator('#edit-name').inputValue()==='Булка'&&await q.locator('#edit-quantity').inputValue()==='2,5','Черновик объединения восстановлен точно');
    await q.locator('#item-form button[type=submit]').click();await q.locator('#confirm-ok').click();const state=await q.evaluate(key=>JSON.parse(localStorage.getItem(key)),KEY);check(state.trips[0].items.length===1&&state.trips[0].items[0].quantity===3.5,'Повторное объединение сохраняет результат');
  }finally{await forms.close();}
  for(const operation of ['put','open']){
    const context=await page.context().browser().newContext();try{
      const q=await context.newPage();await q.goto(origin);await ready(q);await create(q);await add(q,'Молоко');const before=await q.evaluate(key=>localStorage.getItem(key),KEY);
      await q.evaluate(async()=>{const key=(await caches.keys()).find(k=>k.startsWith('shopping-planner-app-'));await (await caches.open(key)).delete(new URL('script.js',location.href));});
      const worker=context.serviceWorkers()[0];await worker.evaluate(op=>{if(op==='put')Cache.prototype.put=()=>Promise.reject(new DOMException('quota','QuotaExceededError'));else CacheStorage.prototype.open=()=>Promise.reject(new DOMException('denied','SecurityError'));},operation);
      await q.reload();await q.locator('#trip').waitFor({state:'visible'});await q.locator('#retry-offline').waitFor({state:'visible'});
      check(await q.evaluate(key=>localStorage.getItem(key),KEY)===before&&await q.locator('.item').count()===1,'Сетевой запуск при отказе CacheStorage.'+operation);
      check(await q.locator('#offline-status').textContent().then(t=>t.includes('Не удалось')),'Нет ложной офлайн-готовности: '+operation);
      await add(q,'Яблоки');check(await q.locator('.item').count()===2,'Покупки работают при отказе кэша: '+operation);
    }finally{await context.close();}
  }
  const updates=await page.context().browser().newContext();try{
    let q=await updates.newPage();await q.goto(origin);await ready(q);await create(q);await add(q,'Сохранено');const before=await q.evaluate(key=>localStorage.getItem(key),KEY);
    await control({version:'v4',cssMarker:'NEW-RELEASE',staleHashes:true});await q.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});
    await q.waitForFunction(async()=>{const reg=await navigator.serviceWorker.getRegistration();return !reg.installing&&!reg.waiting&&!(await caches.keys()).includes('shopping-planner-app-%2F-v4');});
    check(await q.evaluate(async()=>!!await (await caches.open('shopping-planner-app-%2F-v3')).match(new URL('style.css',location.href))),'Несогласованный выпуск отвергается, старый кэш сохранён');
    await control({version:'v4',cssMarker:'NEW-RELEASE',staleHashes:false});await q.evaluate(async()=>{await (await navigator.serviceWorker.getRegistration()).update();});await q.locator('#update-status').waitFor({state:'visible'});
    await q.evaluate(async()=>{const cache=await caches.open('shopping-planner-app-%2F-v3');await cache.delete(new URL('style.css',location.href));});
    const result=await q.evaluate(async()=>{const response=await fetch('./style.css');const cache=await caches.open('shopping-planner-app-%2F-v3');return {status:response.status,cached:!!await cache.match(new URL('style.css',location.href))};});
    check(result.status===503&&!result.cached,'Новый CSS не обслуживается и не записывается старым worker');
    const repair=await q.evaluate(()=>new Promise(resolve=>{const c=new MessageChannel();c.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage({type:'PREPARE_OFFLINE'},[c.port2]);}));
    check(!repair.ready&&await q.evaluate(async()=>{const cache=await caches.open('shopping-planner-app-%2F-v3');return !await cache.match(new URL('style.css',location.href));}),'Повтор подготовки не смешивает выпуски');
    check(await q.evaluate(key=>localStorage.getItem(key),KEY)===before,'Отказ несовместимого файла не меняет покупки');
    await q.close();await new Promise(resolve=>setTimeout(resolve,300));q=await updates.newPage();await q.goto(origin);await ready(q);
    check(await q.evaluate(async()=>{const cache=await caches.open('shopping-planner-app-%2F-v4');return (await (await cache.match(new URL('style.css',location.href))).text()).includes('NEW-RELEASE');}),'После закрытия вкладок применяется весь новый выпуск');
    await updates.setOffline(true);await q.reload();await ready(q);check(await q.locator('.item').count()===1,'Новый выпуск работает офлайн с прежними данными');
  }finally{await updates.close();await control({reset:true});}
  return {passed:checks.length,checks};
}
