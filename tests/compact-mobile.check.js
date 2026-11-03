async(page)=>{
  const context=await page.context().browser().newContext();const q=await context.newPage(),checks=[];
  const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
  try{
    await q.goto('http://127.0.0.1:4173');await q.locator('#create-trip').click();await q.locator('#save-trip').click();
    for(const width of [320,360,375,393,430,650]){
      await q.setViewportSize({width,height:850});
      check(await q.evaluate(()=>{const box=s=>document.querySelector(s).getBoundingClientRect(),name=box('#add-name'),button=box('#add-form .add-button'),quantity=box('#add-form .quantity-control'),unit=box('#add-unit'),up=box('[data-quantity=add][data-direction="1"]'),down=box('[data-quantity=add][data-direction="-1"]');return document.documentElement.scrollWidth<=innerWidth&&[button,quantity,unit].every(b=>Math.abs(b.top-name.top)<1)&&name.right<=button.left&&button.right<=quantity.left&&quantity.right<=unit.left&&Math.abs(up.left-down.left)<1&&up.bottom<=down.top&&name.width>=70;}),`Одна строка и вертикальные стрелки: ${width}px`);
    }
    await q.setViewportSize({width:375,height:850});await q.locator('#add-name').fill('Молоко');await q.locator('#add-quantity').fill('0,5');await q.locator('[data-quantity=add][data-direction="1"]').click();await q.locator('#add-unit').selectOption('л');await q.getByRole('button',{name:'Добавить покупку',exact:true}).click();
    check(await q.evaluate(()=>{const i=JSON.parse(localStorage.getItem('shopping-planner.state.v1')).trips[0].items[0];return i.name==='Молоко'&&i.quantity===1.5&&i.unit==='л';}),'Галочка сохраняет название, дробное количество и единицу');
    await q.reload();check(await q.locator('.item').count()===1,'Покупка восстановлена после перезагрузки');
    await q.locator('#add-quantity').fill('0');await q.getByRole('button',{name:'Добавить покупку',exact:true}).click();check(await q.locator('#add-quantity').getAttribute('aria-invalid')==='true'&&await q.locator('.item').count()===1,'Ошибка количества не сохраняет покупку');
    await q.locator('#add-quantity').fill('1');await q.locator('#add-name').fill('Хлеб');await q.locator('#add-name').press('Enter');check(await q.locator('.item').count()===2,'Enter продолжает добавлять покупку');
    await q.screenshot({path:'C:/Users/User/Documents/ChatGPT/Планировщик покупок/.qa/compact-mobile-375.png',fullPage:true});
    await q.setViewportSize({width:1280,height:850});check(await q.locator('.add-button-text').isVisible()&&await q.locator('.add-button-check').isHidden(),'На компьютере сохранена текстовая кнопка');
    return {passed:checks.length,checks};
  }finally{await context.close();}
}
