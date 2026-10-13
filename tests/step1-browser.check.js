// Запуск браузерной автоматизацией: вызвать эту функцию с Playwright Page.
// Используется отдельный контекст; личные данные и профиль пользователя не затрагиваются.
async (page) => {
  const context = await page.context().browser().newContext({viewport:{width:375,height:812},locale:'ru-RU',timezoneId:'Europe/Moscow'});
  const q = await context.newPage();
  const passed = [], errors = [];
  q.on('pageerror', e => errors.push(e.message));
  const check = (value,name) => { if(!value) throw new Error(name); passed.push(name); };
  const raw = () => q.evaluate(() => localStorage.getItem('shopping-planner.state.v1'));
  const state = async () => JSON.parse(await raw());
  const add = async (name,qty='1',unit='шт.') => {
    await q.locator('#add-name').fill(name);await q.locator('#add-quantity').fill(qty);
    await q.locator('#add-unit').selectOption(unit);await q.locator('#add-form button[type=submit]').click();
  };
  try {
    await q.goto('http://127.0.0.1:4173');
    check(await q.locator('#empty').isVisible() && await raw()===null,'Чистый первый запуск');
    await q.locator('#create-trip').click();
    const expectedDate = await q.evaluate(() => {const d=new Date();return [d.getDate(),d.getMonth()+1,d.getFullYear()].map((v,i)=>i<2?String(v).padStart(2,'0'):v).join('.');});
    check((await q.locator('#trip-name').inputValue()).includes(expectedDate),'Локальная дата по умолчанию');
    await q.locator('#trip-name').fill('  Поход   в магазин ');await q.locator('#save-trip').click();
    check((await state()).trips[0].name==='Поход в магазин' && await q.locator('#create-trip').isHidden(),'Один текущий поход');
    await add('Молоко','0,1','л');await add(' молоко ','0.2','л');
    let s=await state(), milk=s.trips[0].items[0];
    check(milk.quantity===0.3 && s.trips[0].items.length===1 && s.catalog.length===1,'Дубликаты и точная сумма');
    await q.locator(`[data-id="${milk.id}"] input`).click();await add('МОЛОКО','0,7','л');
    check(!(await state()).trips[0].items[0].purchased && (await state()).trips[0].items[0].quantity===1,'Повторное добавление снимает покупку');
    await add('Молоко','2','уп.');await add('Хлеб');
    check((await state()).trips[0].items.length===3,'Разные единицы отдельными строками');
    await q.locator(`[data-id="${milk.id}"] input`).click();
    check(await q.locator('.item').last().getAttribute('data-id')===milk.id,'Купленное внизу');
    await q.locator('[data-filter=remaining]').click();
    check(await q.locator('.item').count()===2 && await q.locator('#progress').textContent()==='Куплено 1 из 3','Фильтр и общий счётчик');
    await q.locator('[data-filter=purchased]').click();await q.locator(`[data-id="${milk.id}"] input`).click();
    check(await q.locator('.item').count()===0,'Пустой фильтр после снятия покупки');
    await q.locator('[data-filter=all]').click();
    check(await q.locator('.item').first().getAttribute('data-id')===milk.id,'Восстановление порядка');
    await q.locator(`[data-id="${milk.id}"] input`).click();await q.locator(`[data-id="${milk.id}"] .edit`).click();
    check((await state()).trips[0].items[0].purchased,'Редактирование не переключает отметку');
    await q.locator('#edit-name').fill('Кефир');await q.locator('#edit-quantity').fill('3');await q.locator('#item-form button[type=submit]').click();
    check((await state()).trips[0].items[0].purchased && (await state()).catalog.some(c=>c.name==='Кефир'),'Редактирование и пополнение каталога');
    let bread=(await state()).trips[0].items.find(i=>i.name==='Хлеб');
    await q.locator(`[data-id="${bread.id}"] .edit`).click();await q.locator('#edit-name').fill('Кефир');await q.locator('#edit-unit').selectOption('л');await q.locator('#item-form button[type=submit]').click();
    let before=await raw();await q.locator('#confirm-cancel').click();
    check(await raw()===before && await q.locator('#item-dialog').isVisible(),'Отмена объединения');
    await q.locator('#item-form button[type=submit]').click();await q.locator('#confirm-ok').click();
    check((await state()).trips[0].items.length===2 && (await state()).trips[0].items[0].quantity===4 && !(await state()).trips[0].items[0].purchased,'Подтверждённое объединение');
    const item=(await state()).trips[0].items[0];
    await q.locator(`[data-id="${item.id}"] .delete`).click();await q.locator('#undo').click();
    check(JSON.stringify((await state()).trips[0].items.find(i=>i.id===item.id))===JSON.stringify(item),'Точная отмена удаления');
    await q.locator(`[data-id="${item.id}"] .delete`).click();await q.locator('[data-filter=remaining]').click();
    check(await q.locator('#undo').isVisible(),'Фильтр не сбрасывает отмену');await q.waitForTimeout(10200);
    check(await q.locator('#undo').isHidden(),'Отмена истекает через 10 секунд');await q.locator('[data-filter=all]').click();
    const remaining=(await state()).trips[0].items[0];await q.locator(`[data-id="${remaining.id}"] .delete`).click();await add('Яблоки');
    check(await q.locator('#undo').isHidden(),'Следующее изменение отменяет восстановление');
    for(const value of ['', '0', '-1', '1e3', '0,0001', '1.2,3', '1000000']) {
      before=await raw();await add('Ошибка',value);
      check(await raw()===before && await q.locator('#add-quantity').getAttribute('aria-invalid')==='true',`Неверное количество: ${value||'пусто'}`);
    }
    before=await raw();await add('   ');check(await raw()===before,'Пустое название не записывается');
    await add('Граница','999999,999');before=await raw();await add('Граница','0,001');
    check(await raw()===before,'Переполнение суммы не меняет данные');
    await q.locator('#add-name').fill('Двойной клик');await q.locator('#add-quantity').fill('1');await q.locator('#add-form button[type=submit]').dblclick();
    check((await state()).trips[0].items.find(i=>i.name==='Двойной клик').quantity===1 && await q.locator('#add-name-error').textContent()==='','Двойная отправка без дубликата и ложной ошибки');
    await q.evaluate(()=>{window.savedSetItem=Storage.prototype.setItem;Storage.prototype.setItem=function(key,value){if(key==='shopping-planner.state.v1')throw new DOMException('Quota','QuotaExceededError');return window.savedSetItem.call(this,key,value);};});
    before=await raw();await add('Отказ записи');
    check(await raw()===before && await q.locator('#add-name').inputValue()==='Отказ записи' && await q.locator('#storage-error').isVisible(),'Отказ записи сохраняет данные и черновик');
    await q.evaluate(()=>{Storage.prototype.setItem=window.savedSetItem;delete window.savedSetItem;});await q.locator('#add-form button[type=submit]').click();
    check((await state()).trips[0].items.some(i=>i.name==='Отказ записи'),'Повтор после отказа');
    await add('<img src=x onerror=alert(1)>','0,001');
    check(await q.locator('#items img').count()===0 && (await q.locator('.item-name').allTextContents()).includes('<img src=x onerror=alert(1)>'),'Пользовательский HTML не исполняется');
    await add('ДлинноеНазвание'.repeat(8).slice(0,100));
    for(const width of [320,375,768,1280]) {
      await q.setViewportSize({width,height:900});
      const good=await q.evaluate(()=>document.documentElement.scrollWidth<=innerWidth && [...document.querySelectorAll('button')].filter(b=>b.getClientRects().length).every(b=>b.getBoundingClientRect().height>=44 && b.getBoundingClientRect().width>=44) && [...document.querySelectorAll('input:not([type=checkbox]),select')].filter(b=>b.getClientRects().length).every(b=>parseFloat(getComputedStyle(b).fontSize)>=16));
      check(good,`Ширина ${width}px, размеры кнопок и шрифта`);
    }
    await q.setViewportSize({width:375,height:812});await q.locator('#edit-trip').click();
    await q.locator('#trip-name').fill('Изменённый поход');await q.locator('#trip-date-input').fill('1900-01-01');await q.locator('#save-trip').click();
    check((await state()).trips[0].name==='Изменённый поход','Редактирование похода');
    await q.locator('#edit-trip').click();await q.locator('#trip-date-input').fill('1899-12-31');before=await raw();await q.locator('#save-trip').click();
    check(await raw()===before,'Недопустимая дата не записывается');
    for(let i=0;i<8;i++){await q.keyboard.press('Tab');check(await q.evaluate(()=>!!document.activeElement.closest('#trip-dialog')),'Фокус остаётся в диалоге');}
    await q.keyboard.press('Escape');check(await q.locator('#edit-trip').evaluate(el=>el===document.activeElement),'Escape возвращает фокус');
    before=await raw();await q.reload();check(await raw()===before,'Перезагрузка сохраняет JSON');
    await q.close();const reopened=await context.newPage();await reopened.goto('http://127.0.0.1:4173');
    check(await reopened.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===before,'Повторное открытие сохраняет JSON');
    await reopened.screenshot({path:'C:/Users/User/Documents/ChatGPT/Планировщик покупок/.qa/step1-mobile.png',fullPage:true});
    await reopened.setViewportSize({width:1280,height:900});await reopened.screenshot({path:'C:/Users/User/Documents/ChatGPT/Планировщик покупок/.qa/step1-desktop.png',fullPage:true});
    await reopened.locator('#delete-trip').click();await reopened.locator('#confirm-cancel').click();
    check(await reopened.evaluate(()=>localStorage.getItem('shopping-planner.state.v1'))===before,'Отмена удаления похода');
    await reopened.locator('#delete-trip').click();await reopened.locator('#confirm-ok').click();
    s=await reopened.evaluate(()=>JSON.parse(localStorage.getItem('shopping-planner.state.v1')));
    check(s.trips.length===0 && s.catalog.length>0 && await reopened.locator('#empty').isVisible(),'Удаление похода сохраняет каталог');
    check(errors.length===0,'Нет ошибок JavaScript');
    return {passed:passed.length,checks:passed};
  } finally {await context.close();}
}

