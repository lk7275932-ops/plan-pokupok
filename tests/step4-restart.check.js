async(page)=>{
  const type=page.context().browser().browserType(),options={headless:true,executablePath:'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'};
  const profile='C:/Users/User/Documents/ChatGPT/Планировщик покупок/.qa/step4-offline-profile';let context=await type.launchPersistentContext(profile,options);let q=context.pages()[0];
  try{
    await q.addInitScript(()=>{window.addEventListener('beforeinstallprompt',e=>{if(e.isTrusted)window.trustedInstallPrompt=true;});window.addEventListener('appinstalled',()=>window.nativeInstalled=true);});
    await q.goto('http://127.0.0.1:4173');await q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor();await q.evaluate(()=>localStorage.removeItem('shopping-planner.state.v1'));await q.reload();await q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor();
    await q.locator('#create-trip').click();await q.locator('#save-trip').click();await q.locator('#add-name').fill('Хлеб');await q.locator('#add-form button[type=submit]').click();await q.locator('.item input').click();await q.locator('#add-name').fill('Молоко');await q.locator('#add-form button[type=submit]').click();await q.locator('#transfer-trip').click();await q.locator('#save-trip').click();
    const cdp=await context.newCDPSession(q),errors=await cdp.send('Page.getInstallabilityErrors');await q.waitForTimeout(1500);const actualPrompt=await q.evaluate(()=>!!window.trustedInstallPrompt);let attempted=false;
    if(actualPrompt&&await q.locator('#install-app').isVisible()){attempted=true;await q.locator('#install-app').click();await q.waitForTimeout(1000);}
    const nativeInstalled=await q.evaluate(()=>!!window.nativeInstalled),before=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));
    await context.close();context=await type.launchPersistentContext(profile,options);await context.setOffline(true);q=context.pages()[0];await q.goto('http://127.0.0.1:4173');await q.locator('#offline-status').filter({hasText:'Готово к работе без интернета'}).waitFor();
    const after=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));if(after!==before)throw Error('Данные изменились после перезапуска');
    await q.locator('#add-name').fill('Яблоки');await q.locator('#add-form button[type=submit]').click();if(await q.locator('.item').count()!==2)throw Error('Не удалось добавить офлайн');
    return {browserRestartOffline:true,sameJSON:true,offlineMutation:true,edgeInstallability:errors.installabilityErrors,trustedInstallEvent:actualPrompt,nativePromptAttempted:attempted,nativeInstallVerified:nativeInstalled};
  }finally{await context.close();}
}
