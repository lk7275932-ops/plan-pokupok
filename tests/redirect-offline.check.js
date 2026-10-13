async(page)=>{
  const origin='http://127.0.0.1:4173',checks=[];
  const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
  await page.request.post(origin+'/_qa/control',{data:{redirectIndex:true}});
  for(const base of ['/','/nested/']){
    if(base!=='/')await page.request.post(origin+'/_qa/control',{data:{scope:base,redirectIndex:true}});
    const context=await page.context().browser().newContext();let q=await context.newPage();try{
      await q.goto(origin+base);await q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor();
      check(await q.evaluate(async()=>{const names=await caches.keys();const cache=await caches.open(names.find(n=>n.startsWith('shopping-planner-app-')));return (await Promise.all((await cache.keys()).map(r=>cache.match(r)))).every(r=>!r.redirected);}),`Кэш без redirected: ${base}`);
      await q.locator('#create-trip').click();await q.locator('#save-trip').click();await q.locator('#add-name').fill('Сохранено');await q.locator('#add-form button[type=submit]').click();const before=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));
      await context.setOffline(true);await q.reload();check(await q.locator('.item').count()===1,`Перезагрузка без сети: ${base}`);
      await q.close();q=await context.newPage();await q.goto(origin+base+'index.html');check(await q.locator('.item').count()===1&&await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===before,`Повторное открытие index.html без сети: ${base}`);
    }finally{await context.close();await page.request.post(origin+'/_qa/control',{data:{scope:base,reset:true}});}
  }
  return {passed:checks.length,checks};
}
