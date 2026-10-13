async(page)=>{
  const context=await page.context().browser().newContext({viewport:{width:375,height:812}});const q=await context.newPage();const checks=[];
  const check=(value,name)=>{if(!value)throw Error(name);checks.push(name);};
  try{
    await q.goto('http://127.0.0.1:4173');await q.locator('#create-trip').click();await q.locator('#save-trip').click();
    const before=await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'));
    await q.locator('[data-quantity=add][data-direction="1"]').click();check(await q.locator('#add-quantity').inputValue()==='2','Стрелка увеличивает на 1');
    await q.locator('[data-quantity=add][data-direction="-1"]').click();await q.locator('[data-quantity=add][data-direction="-1"]').click();check(await q.locator('#add-quantity').inputValue()==='1','Стрелка уменьшает, не выходит за нижнюю границу');
    await q.locator('#add-quantity').fill('0,5');await q.locator('[data-quantity=add][data-direction="1"]').click();check(await q.locator('#add-quantity').inputValue()==='1,5','Запятая и дробная часть сохраняются');
    await q.locator('#add-quantity').focus();await q.keyboard.press('ArrowUp');await q.keyboard.press('ArrowDown');check(await q.locator('#add-quantity').inputValue()==='1,5','Клавиатурные стрелки работают');
    check(await q.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===before,'Стрелки не отправляют форму и не сохраняют черновик');
    await q.locator('#add-quantity').fill('999999,999');await q.locator('[data-quantity=add][data-direction="1"]').click();check(await q.locator('#add-quantity').inputValue()==='999999,999','Верхняя граница не превышается');
    await q.locator('#add-quantity').fill('ошибка');await q.locator('[data-quantity=add][data-direction="1"]').click();check(await q.locator('#add-quantity').inputValue()==='ошибка'&&await q.locator('#add-quantity').getAttribute('aria-invalid')==='true','Ошибочный ввод не заменяется молча');
    await q.locator('#add-name').fill('Молоко');await q.locator('#add-quantity').fill('1');await q.locator('[data-quantity=add][data-direction="1"]').click();await q.locator('#add-form button[type=submit]').click();
    check(await q.evaluate(()=>JSON.parse(localStorage.getItem('shopping-planner.state.v1')).trips[0].items[0].quantity)===2,'Выбранное количество сохраняется при добавлении');
    await q.locator('.item .edit').click();await q.locator('[data-quantity=edit][data-direction="1"]').click();check(await q.locator('#edit-quantity').inputValue()==='3','Стрелки в редактировании');await q.locator('#item-form button[type=submit]').click();
    check(await q.evaluate(()=>JSON.parse(localStorage.getItem('shopping-planner.state.v1')).trips[0].items[0].quantity)===3,'Редактирование сохраняет количество');
    for(const width of [320,375,768,1280]){await q.setViewportSize({width,height:900});check(await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth&&[...document.querySelectorAll('[data-quantity=add]')].every(b=>b.getBoundingClientRect().width>=44&&b.getBoundingClientRect().height>=44)),`Размеры и адаптивность ${width}px`);}
    await q.setViewportSize({width:375,height:812});await q.screenshot({path:'C:/Users/User/Documents/ChatGPT/Планировщик покупок/.qa/quantity-arrows.png',fullPage:true});
    return {passed:checks.length,checks};
  }finally{await context.close();}
}
