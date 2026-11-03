async(page)=>{
  const context=await page.context().browser().newContext();const q=await context.newPage(),checks=[];
  const check=(v,n)=>{if(!v)throw Error(n);checks.push(n);};
  try{
    await q.goto('http://127.0.0.1:4173');await q.locator('#create-trip').click();await q.locator('#trip-date-input').fill('2026-11-03');await q.locator('#save-trip').click();
    for(const width of [320,375,430,650]){
      await q.setViewportSize({width,height:850});
      check(await q.locator('#trip-date').isHidden()&&await q.locator('#trip>.trip-heading .eyebrow').isHidden()&&await q.locator('.edit-trip-text').isHidden()&&await q.locator('.edit-trip-icon').isVisible(),`Нет повторной даты и подписи: ${width}px`);
      check(await q.evaluate(()=>{const head=document.querySelector('#trip>.trip-heading').getBoundingClientRect(),button=document.querySelector('#edit-trip').getBoundingClientRect(),title=document.querySelector('#trip-title').getBoundingClientRect(),form=document.querySelector('.add-card').getBoundingClientRect(),nav=document.querySelector('.navigation').getBoundingClientRect();return document.documentElement.scrollWidth<=innerWidth&&title.right<=button.left&&button.width>=44&&button.height>=44&&form.top-head.bottom<=11&&head.top-nav.bottom<=13;}),`Карандаш справа и компактные отступы: ${width}px`);
    }
    await q.setViewportSize({width:375,height:850});await q.getByRole('button',{name:'Изменить поход',exact:true}).click();check(await q.locator('#trip-date-input').inputValue()==='2026-11-03','Карандаш открывает редактирование с сохранённой датой');await q.locator('#trip-name').fill('Очень длинное название похода в магазин '.repeat(2));await q.locator('#trip-date-input').fill('2026-11-04');await q.locator('#save-trip').click();
    await q.setViewportSize({width:320,height:850});check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&document.querySelector('#trip-title').getBoundingClientRect().height>30),'Длинное название переносится без горизонтального скролла');
    await q.reload();check(await q.locator('#trip-title').textContent().then(t=>t.startsWith('Очень длинное')),'Название сохраняется после перезапуска');await q.locator('#edit-trip').click();check(await q.locator('#trip-date-input').inputValue()==='2026-11-04','Дата сохраняется и доступна через карандаш');await q.keyboard.press('Escape');check(await q.locator('#edit-trip').evaluate(el=>document.activeElement===el),'Escape возвращает фокус карандашу');
    await q.locator('#edit-trip').click();await q.locator('#trip-name').fill('Покупки — 04.11.2026');await q.locator('#save-trip').click();await q.setViewportSize({width:375,height:850});await q.locator('#add-name').fill('Молоко');await q.screenshot({path:'C:/Users/User/Documents/ChatGPT/Планировщик покупок/.qa/compact-header-375.png',fullPage:true});
    await q.setViewportSize({width:1280,height:850});check(await q.locator('#trip-date').isVisible()&&await q.locator('.edit-trip-text').isVisible()&&await q.locator('.edit-trip-icon').isHidden(),'Компьютерная шапка сохранена');
    return {passed:checks.length,checks};
  }finally{await context.close();}
}
