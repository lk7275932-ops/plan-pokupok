async(page)=>{
  const context=await page.context().browser().newContext({viewport:{width:375,height:812}});const q=await context.newPage();const checks=[];const check=(v,n)=>{if(!v)throw Error(n);checks.push(n);};
  try{
    await q.goto('http://127.0.0.1:4173');await q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor();
    const cdp=await context.newCDPSession(q);const manifest=await cdp.send('Page.getAppManifest');check(!manifest.errors.length&&JSON.parse(manifest.data).display==='standalone','Браузер разбирает манифест без ошибок');
    const installability=await cdp.send('Page.getInstallabilityErrors');
    const before=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));
    async function fake(outcome,error=false){await q.evaluate(({outcome,error})=>{const e=new Event('beforeinstallprompt',{cancelable:true});Object.defineProperty(e,'prompt',{value:()=>{window.fakePromptCalls=(window.fakePromptCalls||0)+1;return error?Promise.reject(Error('test')):Promise.resolve();}});Object.defineProperty(e,'userChoice',{value:Promise.resolve({outcome})});window.dispatchEvent(e);window.prevented=e.defaultPrevented;},{outcome,error});}
    await fake('dismissed');check(await q.locator('#install-app').isVisible()&&await q.evaluate(()=>window.prevented),'Событие сохранено, кнопка доступна только после готовности');check(await q.evaluate(()=>window.fakePromptCalls||0)===0,'Нет автоматического вызова установки');await q.locator('#install-app').click();check(await q.evaluate(()=>window.fakePromptCalls)===1&&await q.locator('#install-app').isHidden(),'Однократный вызов и скрытие после отказа');check(await q.locator('#install-help').isVisible(),'Отказ не скрывает справку');
    await fake('dismissed',true);await q.locator('#install-app').click();await q.locator('#install-dialog').waitFor({state:'visible'});check(await q.locator('#install-app').isHidden(),'Ошибка установки открывает справку');await q.locator('[data-close=install-dialog]').click();
    for(const section of ['current','catalog','history']){await q.locator(`[data-section=${section}]`).click();await q.locator('#install-help').click();check(await q.locator('#install-dialog').isVisible(),`Справка доступна: ${section}`);await q.keyboard.press('Escape');check(await q.locator('#install-help').evaluate(el=>el===document.activeElement),`Возврат фокуса из справки: ${section}`);}
    await fake('accepted');await q.locator('#install-app').click();check(await q.locator('#install-help').isHidden()&&await q.locator('#install-app').isHidden(),'Принятая установка скрывает предложение');await q.evaluate(()=>dispatchEvent(new Event('appinstalled')));check(await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===before,'Установка не меняет данные покупок');
    await q.screenshot({path:'C:/Users/User/Documents/ChatGPT/Планировщик покупок/.qa/step4-ready.png',fullPage:true});
    const resources=await q.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));check(resources.every(url=>url.startsWith('http://127.0.0.1:4173')),'Нет внешних ресурсов');
    return {passed:checks.length,checks,installability:installability.installabilityErrors,browser:page.context().browser().version(),nativeInstallVerified:false};
  }finally{await context.close();}
}
