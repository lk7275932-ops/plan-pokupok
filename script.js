/* Планировщик покупок: локальные данные, защищённое сохранение и офлайн-запуск. */
(() => {
  'use strict';
  const KEY = 'shopping-planner.state.v1';
  const UNITS = ['шт.', 'кг', 'г', 'л', 'мл', 'уп.'];
  const MAX_MILLI = 999999999;
  const CURRENT_SCHEMA_VERSION=1;
  const MIGRATIONS=new Map(); // Будущие шаги N → N+1 с validateBefore/validateAfter и transform.
  const normalize = value => String(value).normalize('NFC').trim().replace(/\s+/gu, ' ');
  const nameKey = value => normalize(value).toLocaleLowerCase('ru-RU');
  const id = () => globalThis.crypto?.randomUUID?.() || Array.from(globalThis.crypto.getRandomValues(new Uint32Array(4)), n => n.toString(16).padStart(8, '0')).join('-');
  const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
  const dateLabel = date => date.split('-').reverse().join('.');
  const autoTripName = date => `Покупки — ${dateLabel(date)}`;
  const qtyLabel = qty => new Intl.NumberFormat('ru-RU', {maximumFractionDigits:3, useGrouping:false}).format(qty);
  function validDate(value) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '1900-01-01' || value > '2100-12-31') return false;
    const [y,m,d] = value.split('-').map(Number);
    const date = new Date(Date.UTC(y,m-1,d));
    return date.getUTCFullYear() === y && date.getUTCMonth() === m-1 && date.getUTCDate() === d;
  }
  function parseQuantity(raw) {
    const value = String(raw).trim();
    if (!/^\d+(?:[.,]\d{1,3})?$/.test(value)) throw new Error('Введите число с точностью до трёх знаков после запятой.');
    const [whole, fraction = ''] = value.replace(',', '.').split('.');
    const milli = Number(whole) * 1000 + Number(fraction.padEnd(3,'0'));
    if (!Number.isSafeInteger(milli) || milli < 1 || milli > MAX_MILLI) throw new Error('Количество должно быть от 0,001 до 999999,999.');
    return milli / 1000;
  }
  function sumQuantity(a,b) {
    const milli = Math.round(a*1000) + Math.round(b*1000);
    if (milli > MAX_MILLI) throw new Error('Суммарное количество превышает 999999,999.');
    return milli/1000;
  }
  function validName(raw,max) { const v = normalize(raw); if (!v || v.length > max) throw new Error(`Введите название от 1 до ${max} символов.`); return v; }
  const emptyState = () => ({schemaVersion:1, revision:0, updatedAt:new Date().toISOString(), trips:[], catalog:[]});
  const activeTrip = s => s.trips.find(t => t.status === 'active');
  const newTrip = (name,date,items=[]) => {const now=new Date().toISOString();return {id:id(),name,date,status:'active',createdAt:now,updatedAt:now,completedAt:null,completionReason:null,transferredItemCount:0,items};};
  function completeTrip(s,tripId,reason='manual',count=0) {
    const t=activeTrip(s);if(!t || t.id!==tripId)throw new Error('Текущий поход изменился. Обновите страницу.');
    Object.assign(t,{status:'completed',completedAt:new Date().toISOString(),completionReason:reason,transferredItemCount:count});t.updatedAt=t.completedAt;
  }
  function transferTrip(s,tripId,name,date) {
    const t=activeTrip(s);if(!t || t.id!==tripId)throw new Error('Текущий поход изменился. Обновите страницу.');
    const items=t.items.filter(i=>!i.purchased).sort((a,b)=>a.order-b.order);
    if(!items.length)throw new Error('Некупленные товары больше не существуют.');
    t.items=t.items.filter(i=>i.purchased);completeTrip(s,tripId,'transfer',items.length);
    s.trips.push(newTrip(name,date,items.map((i,order)=>({...i,order}))));
  }
  const sortedCatalog = (s,query='') => s.catalog.filter(c=>nameKey(c.name).includes(nameKey(query))).sort((a,b)=>a.name.localeCompare(b.name,'ru-RU')||a.id.localeCompare(b.id));
  const sortedHistory = s => s.trips.filter(t=>t.status==='completed').sort((a,b)=>b.completedAt.localeCompare(a.completedAt)||b.createdAt.localeCompare(a.createdAt)||a.id.localeCompare(b.id));
  function catalogName(s,name) { if (!s.catalog.some(c => nameKey(c.name) === nameKey(name))) s.catalog.push({id:id(),name}); }
  function addItem(s,tripId,data) {
    const t = activeTrip(s);
    if (!t || t.id !== tripId) throw new Error('Текущий поход изменился. Обновите страницу.');
    const target = t.items.find(i => nameKey(i.name) === nameKey(data.name) && i.unit === data.unit);
    if (target) { target.quantity = sumQuantity(target.quantity,data.quantity); target.purchased = false; }
    else t.items.push({id:id(),...data,purchased:false,order:Math.max(-1,...t.items.map(i=>i.order))+1});
    catalogName(s,data.name);
    t.updatedAt = new Date().toISOString();
    return !!target;
  }
  function editItem(s,tripId,itemId,data,merge) {
    const t = activeTrip(s);
    if (!t || t.id !== tripId) throw new Error('Текущий поход изменился. Обновите страницу.');
    const item = t.items.find(i=>i.id===itemId);
    if (!item) throw new Error('Товар больше не существует.');
    const other = t.items.find(i => i.id!==itemId && nameKey(i.name)===nameKey(data.name) && i.unit===data.unit);
    if (other) {
      if (!merge) throw new Error('Требуется подтверждение объединения.');
      other.quantity = sumQuantity(other.quantity,data.quantity); other.purchased=false;
      t.items = t.items.filter(i=>i.id!==itemId);
    } else Object.assign(item,data);
    catalogName(s,data.name); t.updatedAt = new Date().toISOString();
  }
  function loadValid(s) {
    const record=(v,keys)=>v && typeof v==='object' && !Array.isArray(v) && Object.keys(v).length===keys.length && keys.every(k=>Object.hasOwn(v,k));
    const integer=v=>Number.isSafeInteger(v)&&v>=0;
    const iso=v=>typeof v==='string' && Number.isFinite(Date.parse(v)) && new Date(v).toISOString()===v;
    const name=(v,max)=>typeof v==='string' && v===normalize(v) && v.length>0 && v.length<=max;
    const unique=(set,v)=>typeof v==='string' && v.length>0 && !set.has(v) && (set.add(v),true);
    try {
      if(!record(s,['schemaVersion','revision','updatedAt','trips','catalog']) || s.schemaVersion!==1 || !integer(s.revision) || !iso(s.updatedAt) || !Array.isArray(s.trips) || !Array.isArray(s.catalog))return false;
      const trips=new Set(),items=new Set(),catalogIds=new Set(),catalogNames=new Set();let active=0;
      for(const t of s.trips) {
        if(!record(t,['id','name','date','status','createdAt','updatedAt','completedAt','completionReason','transferredItemCount','items']) || !unique(trips,t.id) || !name(t.name,80) || typeof t.date!=='string' || !validDate(t.date) || !iso(t.createdAt) || !iso(t.updatedAt) || !integer(t.transferredItemCount) || !Array.isArray(t.items))return false;
        if(t.status==='active'){if(++active>1 || t.completedAt!==null || t.completionReason!==null || t.transferredItemCount!==0)return false;}
        else if(t.status==='completed'){if(!iso(t.completedAt) || !['manual','transfer'].includes(t.completionReason) || (t.completionReason==='manual'?t.transferredItemCount!==0:t.transferredItemCount<1))return false;}
        else return false;
        const orders=new Set(),pairs=new Set();
        for(const i of t.items) {
          if(!record(i,['id','name','quantity','unit','purchased','order']) || !unique(items,i.id) || !name(i.name,100) || typeof i.quantity!=='number' || !Number.isFinite(i.quantity) || i.quantity<0.001 || i.quantity>999999.999 || Math.abs(i.quantity*1000-Math.round(i.quantity*1000))>0.000001 || !UNITS.includes(i.unit) || typeof i.purchased!=='boolean' || !integer(i.order) || orders.has(i.order))return false;
          if(t.completionReason==='transfer' && !i.purchased)return false;
          const pair=JSON.stringify([nameKey(i.name),i.unit]);if(pairs.has(pair))return false;pairs.add(pair);orders.add(i.order);
        }
      }
      for(const c of s.catalog){if(!record(c,['id','name']) || !unique(catalogIds,c.id) || !name(c.name,100) || catalogNames.has(nameKey(c.name)))return false;catalogNames.add(nameKey(c.name));}
      return true;
    }catch{return false;}
  }
  function migrateState(parsedState) {
    if(!parsedState || !Number.isInteger(parsedState.schemaVersion) || parsedState.schemaVersion<1 || parsedState.schemaVersion>CURRENT_SCHEMA_VERSION)throw new Error('Неподдерживаемая версия данных.');
    if(parsedState.schemaVersion===CURRENT_SCHEMA_VERSION){if(!loadValid(parsedState))throw new Error('Некорректные данные.');return {state:parsedState,migrated:false};}
    let next=structuredClone(parsedState);
    while(next.schemaVersion<CURRENT_SCHEMA_VERSION) {
      const step=MIGRATIONS.get(next.schemaVersion);if(!step || !step.validateBefore(next))throw new Error('Нет безопасного преобразования данных.');
      const previousVersion=next.schemaVersion;next=step.transform(next);
      if(!next || next.schemaVersion!==previousVersion+1 || !step.validateAfter(next))throw new Error('Ошибка преобразования данных.');
    }
    if(!loadValid(next))throw new Error('Некорректный результат преобразования.');return {state:next,migrated:true};
  }
  const storageBytes=raw=>raw===null?0:2*(KEY.length+raw.length);
  if (typeof module !== 'undefined' && module.exports) { module.exports={normalize,nameKey,validDate,parseQuantity,sumQuantity,emptyState,addItem,editItem,loadValid,newTrip,completeTrip,transferTrip,sortedCatalog,sortedHistory,migrateState,storageBytes}; return; }
  const $ = selector => document.querySelector(selector);
  let state, original, filter='all', undo=null, undoTimer, noticeTimer, tripMode, editingId, confirmation=null;
  let locked=false;
  let lockReason=null, quotaError=false, suspendedDraft=null;
  let section='current', selectedHistory=null, historyFilter='all', itemMode='edit', pendingCatalogName=null, transferSource=null;
  let suggestedTripName=null;
  const suggestionState=new Map();
  const dialogTriggers=new WeakMap();
  const showError = text => {
    $('#storage-error').textContent=text; $('#storage-error').hidden=false;
    const dialogs=[...document.querySelectorAll('dialog[open]')];
    const dialog=dialogs.at(-1);
    if(dialog) {
      let message=dialog.querySelector('.dialog-error');
      if(!message) {message=document.createElement('p');message.className='notice error dialog-error';message.setAttribute('role','alert');dialog.querySelector('.dialog-actions').before(message);}
      message.textContent=text;message.hidden=false;
      dialog.querySelector('.dialog-cleanup')?.remove();
      if(quotaError){const actions=document.createElement('div');actions.className='dialog-cleanup';for(const target of ['history','catalog']){const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent=target==='history'?'Открыть историю':'Открыть каталог';button.addEventListener('click',()=>goCleanup(target));actions.append(button);}message.after(actions);}
    }
    $('#quota-actions').hidden=!quotaError;
  };
  function clearUndo() { clearTimeout(undoTimer); undo=null; $('#undo').hidden=true; }
  function notify(text,canUndo=false) {
    clearTimeout(noticeTimer); $('#notification-text').textContent=text; $('#notification').hidden=false; $('#undo').hidden=!canUndo;
    if (!canUndo) noticeTimer=setTimeout(()=>{$('#notification').hidden=true;},4000);
  }
  function commit(change) {
    if (locked) return false;
    try {
      if (localStorage.getItem(KEY)!==original) {blockConflict();return false;}
      const oldTripId=activeTrip(state)?.id;
      const next = structuredClone(state); change(next);
      next.revision++; next.updatedAt=new Date().toISOString();
      if(!loadValid(next))throw new Error('Некорректный результат изменения данных.');
      const json=JSON.stringify(next); localStorage.setItem(KEY,json);
      state=next; original=json;quotaError=false; clearUndo(); $('#notification').hidden=true; $('#storage-error').hidden=true;$('#quota-actions').hidden=true;
      if(oldTripId && oldTripId!==activeTrip(state)?.id){$('#add-form').reset();suspendedDraft=null;}
      if(suspendedDraft && (!activeTrip(state) || activeTrip(state).id!==suspendedDraft.tripId || (suspendedDraft.mode==='edit' && !activeTrip(state).items.some(i=>i.id===suspendedDraft.itemId))))suspendedDraft=null;
      document.querySelectorAll('.dialog-error').forEach(el=>el.hidden=true);document.querySelectorAll('.dialog-cleanup').forEach(el=>el.remove());render(); return true;
    } catch(e) {
      quotaError=e.name==='QuotaExceededError';
      const text = quotaError?'В хранилище браузера не хватает места. Удалите ненужные походы или названия из каталога и повторите действие.':e.message.includes('превышает') || e.message.includes('измен') || e.message.includes('существует') ? e.message : 'Не удалось сохранить изменения. Проверьте доступ к хранилищу браузера или свободное место.';
      showError(text); return false;
    }
  }
  function fieldError(id,text='') { const el=$(`#${id}`); el.setAttribute('aria-invalid',String(!!text)); $(`#${id}-error`).textContent=text; }
  function clearFields(ids) { ids.forEach(i=>fieldError(i)); }
  function readItem(prefix) {
    const data={}; let first=null;
    clearFields([`${prefix}-name`,`${prefix}-quantity`]);
    try {data.name=validName($(`#${prefix}-name`).value,100);} catch(e) {fieldError(`${prefix}-name`,e.message);first=$(`#${prefix}-name`);}
    try {data.quantity=parseQuantity($(`#${prefix}-quantity`).value);} catch(e) {fieldError(`${prefix}-quantity`,e.message);first ||= $(`#${prefix}-quantity`);}
    data.unit=$(`#${prefix}-unit`).value;
    if (!UNITS.includes(data.unit)) return null;
    if (first) {first.focus();return null;} return data;
  }
  function openDialog(el) {
    let trigger=document.activeElement;const previous=trigger?.closest('dialog');
    if(previous && !previous.open)trigger=dialogTriggers.get(previous)||trigger;
    dialogTriggers.set(el,trigger);el.querySelectorAll('.dialog-error').forEach(e=>e.hidden=true);el.showModal();
  }
  function confirmAction(title,text,label,action,danger=false) {
    $('#confirm-title').textContent=title; $('#confirm-text').textContent=text; $('#confirm-ok').textContent=label;
    $('#confirm-ok').className=danger?'danger':'primary'; $('#confirm-transfer').hidden=true; confirmation=action; openDialog($('#confirm-dialog')); $('#confirm-cancel').focus();
  }
  function iconButton(kind,name) {
    const b=document.createElement('button'); b.className=`icon-button ${kind}`; b.type='button'; b.setAttribute('aria-label',`${kind==='delete'?'Удалить':'Изменить'} ${name}`);
    // Статические SVG, пользовательские названия никогда не вставляются в HTML.
    b.innerHTML=kind==='delete'?'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13M10 10v7m4-7v7"/></svg>':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m15 4 5 5-11 11H4v-5L15 4Z M12 7l5 5"/></svg>';
    return b;
  }
  function render() {
    const t=activeTrip(state); $('#empty').hidden=!!t || locked || section!=='current'; $('#trip').hidden=!t || locked || section!=='current';
    $('#catalog-section').hidden=locked || section!=='catalog';$('#history-section').hidden=locked || section!=='history';
    document.querySelectorAll('[data-section]').forEach(b=>{if(b.dataset.section===section)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');b.disabled=locked;});
    $('#resume-draft').hidden=locked || !suspendedDraft;
    $('#size-warning').hidden=locked || storageBytes(original)<2*1024*1024;
    $('#storage-size').textContent=`Походов в истории: ${state.trips.filter(t=>t.status==='completed').length}. Размер данных: примерно ${new Intl.NumberFormat('ru-RU',{minimumFractionDigits:1,maximumFractionDigits:1}).format(storageBytes(original)/1024)} КиБ.`;
    renderCatalog();renderHistory();
    if (!t || locked) return;
    $('#transfer-trip').disabled=!t.items.some(i=>!i.purchased);
    $('#trip-title').textContent=t.name; $('#trip-date').textContent=dateLabel(t.date);
    $('#progress').textContent=`Куплено ${t.items.filter(i=>i.purchased).length} из ${t.items.length}`;
    document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===filter)));
    const visible=[...t.items].sort((a,b)=>Number(a.purchased)-Number(b.purchased)||a.order-b.order).filter(i=>filter==='all'||(filter==='purchased'?i.purchased:!i.purchased));
    const list=$('#items');list.replaceChildren();
    for (const item of visible) {
      const li=document.createElement('li');li.className=`item${item.purchased?' purchased':''}`;li.dataset.id=item.id;
      const label=document.createElement('label');label.className='item-main';
      const cb=document.createElement('input');cb.type='checkbox';cb.checked=item.purchased;cb.setAttribute('aria-label',`Куплено: ${item.name}`);
      cb.addEventListener('change',()=>{
        const ok=commit(s=>{const trip=activeTrip(s);trip.items.find(i=>i.id===item.id).purchased=cb.checked;trip.updatedAt=new Date().toISOString();});
        if (!ok) cb.checked=item.purchased;
        else {const row=[...$('#items').children].find(r=>r.dataset.id===item.id);(row?.querySelector('input')||$('[data-filter][aria-pressed=true]')).focus();}
      });
      const info=document.createElement('span');info.className='item-info';
      const name=document.createElement('span');name.className='item-name';name.textContent=item.name;
      const qty=document.createElement('span');qty.className='item-quantity';qty.textContent=`${qtyLabel(item.quantity)} ${item.unit}`;info.append(name,qty);label.append(cb,info);
      const actions=document.createElement('div');actions.className='item-actions';
      const edit=iconButton('edit',item.name);edit.addEventListener('click',()=>{
        itemMode='edit';editingId=item.id; $('#item-dialog-title').textContent='Изменить покупку';$('#item-form button[type=submit]').textContent='Сохранить';clearFields(['edit-name','edit-quantity']); $('#edit-name').value=item.name;$('#edit-quantity').value=qtyLabel(item.quantity);$('#edit-unit').value=item.unit;closeSuggestions();openDialog($('#item-dialog'));
      });
      const del=iconButton('delete',item.name);del.addEventListener('click',()=>{
        const snapshot=structuredClone(item);
        if(commit(s=>{const trip=activeTrip(s);trip.items=trip.items.filter(i=>i.id!==item.id);trip.updatedAt=new Date().toISOString();})) {
          undo={tripId:t.id,item:snapshot};notify('Товар удалён',true);$('#undo').focus();
          undoTimer=setTimeout(()=>{clearUndo();$('#notification').hidden=true;},10000);
        }
      });
      actions.append(edit,del);li.append(label,actions);list.append(li);
    }
    $('#list-empty').hidden=visible.length>0;
    $('#list-empty').textContent=filter==='remaining'?'Всё куплено':filter==='purchased'?'Пока ничего не куплено':'Добавьте первую покупку';
  }
  function switchSection(next) {if(next==='history' && section!=='history'){selectedHistory=null;historyFilter='all';}section=next;closeSuggestions();render();}
  function openTripForm(mode='create') {
    tripMode=mode;transferSource=mode==='transfer'?activeTrip(state)?.id:null;
    const date=today(),isTransfer=mode==='transfer';
    $('#trip-dialog-title').textContent=isTransfer?'Следующий поход':'Создать поход';$('#save-trip').textContent=isTransfer?'Перенести':'Создать';
    $('#transfer-note').hidden=!isTransfer;$('#transfer-note').textContent=isTransfer?`Перенесём все некупленные товары (${activeTrip(state).items.filter(i=>!i.purchased).length}). Текущий поход будет завершён.`:'';
    suggestedTripName=autoTripName(date);$('#trip-name').value=suggestedTripName;$('#trip-date-input').value=date;clearFields(['trip-name','trip-date-input']);openDialog($('#trip-dialog'));
  }
  $('#create-trip').addEventListener('click',()=>{pendingCatalogName=null;openTripForm();});
  $('#edit-trip').addEventListener('click',()=>{
    tripMode='edit';$('#transfer-note').hidden=true;const t=activeTrip(state);$('#trip-dialog-title').textContent='Изменить поход';$('#save-trip').textContent='Сохранить';$('#trip-name').value=t.name;$('#trip-date-input').value=t.date;suggestedTripName=t.name===autoTripName(t.date)?t.name:null;clearFields(['trip-name','trip-date-input']);openDialog($('#trip-dialog'));
  });
  function syncTripNameWithDate() {
    const date=$('#trip-date-input').value;
    if(validDate(date) && suggestedTripName!==null && $('#trip-name').value===suggestedTripName){suggestedTripName=autoTripName(date);$('#trip-name').value=suggestedTripName;}
  }
  $('#trip-date-input').addEventListener('input',syncTripNameWithDate);
  $('#trip-date-input').addEventListener('change',syncTripNameWithDate);
  $('#trip-form').addEventListener('submit',e=>{
    e.preventDefault();if(locked || !$('#trip-dialog').open)return;clearFields(['trip-name','trip-date-input']);let name,date=$('#trip-date-input').value,first=null;
    try {name=validName($('#trip-name').value,80);} catch(err) {fieldError('trip-name',err.message);first=$('#trip-name');}
    if(!validDate(date)){fieldError('trip-date-input','Укажите действительную дату с 1900 по 2100 год.');first ||= $('#trip-date-input');}
    if(first){first.focus();return;}
    if(commit(s=>{
      const t=activeTrip(s),now=new Date().toISOString();
      if(tripMode==='transfer')transferTrip(s,transferSource,name,date);
      else if(tripMode==='create') {if(t)throw new Error('Текущий поход уже существует.');s.trips.push(newTrip(name,date));}
      else {if(!t)throw new Error('Текущий поход изменился.');Object.assign(t,{name,date,updatedAt:now});}
    })){
      const catalogNameToAdd=pendingCatalogName;pendingCatalogName=null;filter='all';switchSection('current');closeDialog($('#trip-dialog'));
      if(tripMode==='create' && catalogNameToAdd)openCatalogItem(catalogNameToAdd);else $('#add-name').focus();
    }
  });
  $('#add-form').addEventListener('submit',e=>{
    e.preventDefault();if(locked)return;const data=readItem('add');if(!data)return;
    const t=activeTrip(state);const other=t.items.find(i=>nameKey(i.name)===nameKey(data.name)&&i.unit===data.unit);
    try {if(other)sumQuantity(other.quantity,data.quantity);} catch(err) {fieldError('add-quantity',err.message);$('#add-quantity').focus();return;}
    let merged=false;
    if(commit(s=>{merged=addItem(s,t.id,data);})){e.target.reset();closeSuggestions();clearFields(['add-name','add-quantity']);$('#add-name').focus();notify(merged?'Количество увеличено':'Покупка добавлена');}
  });
  $('#item-form').addEventListener('submit',e=>{
    e.preventDefault();if(locked || !$('#item-dialog').open)return;const data=readItem('edit');if(!data)return;const t=activeTrip(state);
    if(itemMode==='add') {
      const other=t.items.find(i=>nameKey(i.name)===nameKey(data.name)&&i.unit===data.unit);
      try{if(other)sumQuantity(other.quantity,data.quantity);}catch(err){fieldError('edit-quantity',err.message);$('#edit-quantity').focus();return;}
      if(commit(s=>addItem(s,t.id,data))){closeSuggestions();closeDialog($('#item-dialog'));notify(other?'Количество увеличено':'Покупка добавлена');}return;
    }
    const other=t.items.find(i=>i.id!==editingId&&nameKey(i.name)===nameKey(data.name)&&i.unit===data.unit);
    const save=()=>{if(commit(s=>editItem(s,t.id,editingId,data,!!other))){closeDialog($('#item-dialog'));notify(other?'Товары объединены':'Покупка изменена');return true;}return false;};
    if(other) {
      try{sumQuantity(other.quantity,data.quantity);}catch(err){fieldError('edit-quantity',err.message);$('#edit-quantity').focus();return;}
      confirmAction('Объединить товары?',`В списке уже есть «${other.name}», ${qtyLabel(other.quantity)} ${other.unit}. Количества сложатся, отметка покупки снимется.`,'Объединить',save);
    } else save();
  });
  $('#delete-trip').addEventListener('click',()=>{
    const t=activeTrip(state);confirmAction('Удалить поход?',`«${t.name}» и все его товары будут удалены без восстановления. Каталог названий сохранится.`,'Удалить поход',()=>{const ok=commit(s=>{s.trips=s.trips.filter(trip=>trip.id!==t.id);});if(ok){filter='all';$('#create-trip').focus();}return ok;},true);
  });
  $('#confirm-ok').addEventListener('click',()=>{if(confirmation?.())closeDialog($('#confirm-dialog'));});
  $('#confirm-cancel').addEventListener('click',()=>closeDialog($('#confirm-dialog')));
  document.querySelectorAll('[data-close]').forEach(b=>b.addEventListener('click',()=>closeDialog(document.getElementById(b.dataset.close))));
  for(const d of document.querySelectorAll('dialog'))d.addEventListener('keydown',e=>{
    if(e.key!=='Tab')return;
    const fields=[...d.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),[tabindex="0"]')].filter(el=>el.getClientRects().length);
    const first=fields[0],last=fields.at(-1);
    if(e.shiftKey && document.activeElement===first){e.preventDefault();last?.focus();}
    else if(!e.shiftKey && document.activeElement===last){e.preventDefault();first?.focus();}
  });
  function closeDialog(d) {
    if(!d.open)return;
    d.close();
    closeSuggestions();
    if(d.id==='trip-dialog')pendingCatalogName=null;
    if(d.id==='confirm-dialog')confirmation=null;
    const dialogTrigger=dialogTriggers.get(d);
    const opened=[...document.querySelectorAll('dialog[open]')].at(-1);if(opened){if(dialogTrigger && opened.contains(dialogTrigger))dialogTrigger.focus();else opened.querySelector('input,button')?.focus();return;}
    if(dialogTrigger?.isConnected && dialogTrigger.getClientRects().length)dialogTrigger.focus();
    else if(d.id==='item-dialog' && [...$('#items').children].some(row=>row.dataset.id===editingId)) [...$('#items').children].find(row=>row.dataset.id===editingId).querySelector('.edit').focus();
    else if(!$('#trip').hidden)$('#add-name').focus();else if(!$('#empty').hidden)$('#create-trip').focus();else $('[data-section][aria-current=page]')?.focus();
  }
  for(const d of document.querySelectorAll('dialog'))d.addEventListener('cancel',e=>{e.preventDefault();if(d.id!=='conflict-dialog')closeDialog(d);});
  $('#undo').addEventListener('click',()=>{
    if(!undo)return;const saved=undo;
    if(commit(s=>{const t=activeTrip(s);if(!t||t.id!==saved.tripId)throw new Error('Текущий поход изменился.');t.items.push(saved.item);t.updatedAt=new Date().toISOString();})){notify('Товар восстановлен');$('[data-filter][aria-pressed=true]').focus();}
  });
  document.querySelectorAll('[data-filter]').forEach(b=>b.addEventListener('click',()=>{filter=b.dataset.filter;render();}));
  document.querySelectorAll('[data-section]').forEach(b=>b.addEventListener('click',()=>switchSection(b.dataset.section)));
  $('#catalog-search').addEventListener('input',renderCatalog);
  $('#transfer-trip').addEventListener('click',()=>{pendingCatalogName=null;openTripForm('transfer');});
  $('#complete-trip').addEventListener('click',()=>{
    const t=activeTrip(state),remaining=t.items.filter(i=>!i.purchased).length;
    confirmAction('Завершить поход?',remaining?`Осталось ${remaining} товаров. Они останутся в истории; перенести их после завершения нельзя.`:'Список будет сохранён в истории. Новый поход автоматически не создаётся.',remaining?'Завершить без переноса':'Завершить',()=>{
      const ok=commit(s=>completeTrip(s,t.id));if(ok){filter='all';$('#create-trip').focus();}return ok;
    });$('#confirm-transfer').hidden=!remaining;
  });
  $('#confirm-transfer').addEventListener('click',()=>{closeDialog($('#confirm-dialog'));pendingCatalogName=null;openTripForm('transfer');});
  $('#back-history').addEventListener('click',()=>{const old=selectedHistory;selectedHistory=null;renderHistory();[...$('#history-list').querySelectorAll('[data-open-trip]')].find(b=>b.dataset.openTrip===old)?.focus();});
  document.querySelectorAll('[data-history-filter]').forEach(b=>b.addEventListener('click',()=>{historyFilter=b.dataset.historyFilter;renderHistory();}));
  function stepQuantity(prefix,direction) {
    const input=$(`#${prefix}-quantity`);
    try {
      const milli=Math.round(parseQuantity(input.value)*1000);
      const next=milli+direction*1000;
      input.value=qtyLabel((next>=1 && next<=MAX_MILLI?next:milli)/1000);
      fieldError(`${prefix}-quantity`);input.dispatchEvent(new Event('input',{bubbles:true}));
    } catch(error){fieldError(`${prefix}-quantity`,error.message);}
  }
  document.querySelectorAll('[data-quantity]').forEach(button=>button.addEventListener('click',()=>stepQuantity(button.dataset.quantity,Number(button.dataset.direction))));
  for(const prefix of ['add','edit'])$(`#${prefix}-quantity`).addEventListener('keydown',event=>{
    if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();stepQuantity(prefix,event.key==='ArrowUp'?1:-1);}
  });
  $('#delete-history-trip').addEventListener('click',()=>deleteHistoryTrip(selectedHistory));
  $('#clear-history').addEventListener('click',()=>confirmAction('Очистить историю?','Все завершённые походы и их товары будут удалены без восстановления. Текущий поход и каталог сохранятся.','Очистить историю',()=>{
    const ok=commit(s=>{s.trips=s.trips.filter(t=>t.status==='active');});if(ok){selectedHistory=null;renderHistory();}return ok;
  },true));

  function openCatalogItem(name) {
    itemMode='add';editingId=null;switchSection('current');
    $('#item-dialog-title').textContent='Добавить покупку';$('#item-form button[type=submit]').textContent='Добавить';
    clearFields(['edit-name','edit-quantity']);$('#edit-name').value=name;$('#edit-quantity').value='1';$('#edit-unit').value='шт.';openDialog($('#item-dialog'));
  }
  function renderCatalog() {
    const list=$('#catalog-list');list.replaceChildren();const matches=sortedCatalog(state,$('#catalog-search').value);
    for(const entry of matches) {
      const li=document.createElement('li');li.className='catalog-row';li.dataset.id=entry.id;
      const name=document.createElement('span');name.className='catalog-name';name.textContent=entry.name;
      const actions=document.createElement('div');actions.className='catalog-actions';
      const add=document.createElement('button');add.className='secondary';add.textContent='Добавить в поход';add.setAttribute('aria-label',`Добавить в поход: ${entry.name}`);
      add.addEventListener('click',()=>{if(activeTrip(state))openCatalogItem(entry.name);else{pendingCatalogName=entry.name;openTripForm();}});
      const del=iconButton('delete',entry.name);del.setAttribute('aria-label',`Удалить из каталога: ${entry.name}`);
      del.addEventListener('click',()=>confirmAction('Удалить из каталога?',`Название «${entry.name}» исчезнет из подсказок. Товары в походах сохранятся.`,'Удалить название',()=>commit(s=>{s.catalog=s.catalog.filter(c=>c.id!==entry.id);}),true));
      actions.append(add,del);li.append(name,actions);list.append(li);
    }
    $('#catalog-empty').hidden=matches.length>0;$('#catalog-empty').textContent=!state.catalog.length?'Названия появятся после добавления товаров.':'Ничего не найдено';
  }
  function deleteHistoryTrip(tripId) {
    const t=state.trips.find(t=>t.id===tripId && t.status==='completed');if(!t)return;
    confirmAction('Удалить поход?',`«${t.name}» и все его товары будут удалены без восстановления. Каталог сохранится.`,'Удалить поход',()=>{
      const ok=commit(s=>{s.trips=s.trips.filter(t=>t.id!==tripId || t.status!=='completed');});if(ok && selectedHistory===tripId){selectedHistory=null;renderHistory();}return ok;
    },true);
  }
  function renderHistory() {
    const trips=sortedHistory(state),list=$('#history-list');list.replaceChildren();
    $('#clear-history').disabled=!trips.length;
    const selected=trips.find(t=>t.id===selectedHistory);if(!selected)selectedHistory=null;
    list.hidden=!!selected;$('#history-empty').hidden=!!trips.length || !!selected;$('#history-detail').hidden=!selected;
    for(const t of trips) {
      const card=document.createElement('article');card.className='card history-card';card.dataset.id=t.id;
      const body=document.createElement('div'),title=document.createElement('h3'),date=document.createElement('p'),progress=document.createElement('span');
      title.textContent=t.name;date.className='muted';date.textContent=dateLabel(t.date);progress.className='progress';progress.textContent=`Куплено ${t.items.filter(i=>i.purchased).length} из ${t.items.length}`;body.append(title,date,progress);
      const actions=document.createElement('div');actions.className='history-card-actions';
      const open=document.createElement('button');open.className='secondary';open.textContent='Посмотреть';open.dataset.openTrip=t.id;open.setAttribute('aria-label',`Посмотреть: ${t.name}`);
      open.addEventListener('click',()=>{selectedHistory=t.id;historyFilter='all';renderHistory();$('#history-detail-title').focus();});
      const del=iconButton('delete',t.name);del.addEventListener('click',()=>deleteHistoryTrip(t.id));actions.append(open,del);card.append(body,actions);list.append(card);
    }
    if(!selected)return;
    $('#history-detail-title').textContent=selected.name;$('#history-detail-date').textContent=`Дата похода: ${dateLabel(selected.date)}`;
    $('#history-detail-completed').textContent=`Завершён: ${new Intl.DateTimeFormat('ru-RU',{dateStyle:'short',timeStyle:'short'}).format(new Date(selected.completedAt))}`;
    $('#transfer-info').hidden=selected.completionReason!=='transfer';$('#transfer-info').textContent=`Некупленные товары перенесены в следующий поход. Перенесено строк: ${selected.transferredItemCount}.`;
    $('#history-progress').textContent=`Куплено ${selected.items.filter(i=>i.purchased).length} из ${selected.items.length}`;
    document.querySelectorAll('[data-history-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.historyFilter===historyFilter)));
    const items=[...selected.items].sort((a,b)=>Number(a.purchased)-Number(b.purchased)||a.order-b.order).filter(i=>historyFilter==='all'||(historyFilter==='purchased'?i.purchased:!i.purchased));
    const target=$('#history-items');target.replaceChildren();
    for(const item of items) {
      const li=document.createElement('li');li.className=`item readonly-item${item.purchased?' purchased':''}`;
      const mark=document.createElement('span');mark.className='readonly-status';mark.textContent=item.purchased?'✓':'○';mark.setAttribute('aria-hidden','true');
      const info=document.createElement('div');info.className='item-info';const name=document.createElement('span');name.className='item-name';name.textContent=item.name;
      const quantity=document.createElement('span');quantity.className='item-quantity';quantity.textContent=`${qtyLabel(item.quantity)} ${item.unit}`;info.append(name,quantity);
      const status=document.createElement('span');status.className='history-status';status.textContent=item.purchased?'Куплено':'Не куплено';li.append(mark,info,status);target.append(li);
    }
    $('#history-items-empty').hidden=!!items.length;$('#history-items-empty').textContent=!selected.items.length?'В этом походе не осталось товаров.':historyFilter==='remaining'?'Всё куплено':'Пока ничего не куплено';
  }
  function closeSuggestions(prefix) {
    for(const key of prefix?[prefix]:['add','edit']) {
      const input=$(`#${key}-name`);$(`#${key}-suggestions`).hidden=true;input.setAttribute('aria-expanded','false');input.removeAttribute('aria-activedescendant');suggestionState.delete(key);
    }
  }
  function updateSuggestions(prefix) {
    const input=$(`#${prefix}-name`),list=$(`#${prefix}-suggestions`),query=nameKey(input.value);
    if(!query){closeSuggestions(prefix);return;}
    const entries=sortedCatalog(state,query).slice(0,8);suggestionState.set(prefix,{entries,index:-1});list.replaceChildren();
    entries.forEach((entry,index)=>{
      const option=document.createElement('li');option.setAttribute('role','option');option.setAttribute('aria-selected','false');option.id=`${prefix}-suggestion-${index}`;option.textContent=entry.name;
      option.addEventListener('pointerdown',e=>{e.preventDefault();pickSuggestion(prefix,index);});list.append(option);
    });list.hidden=!entries.length;input.setAttribute('aria-expanded',String(!!entries.length));input.removeAttribute('aria-activedescendant');
  }
  function pickSuggestion(prefix,index) {
    const entry=suggestionState.get(prefix)?.entries[index];if(!entry)return;
    $(`#${prefix}-name`).value=entry.name;closeSuggestions(prefix);$(`#${prefix}-name`).focus();
  }
  for(const prefix of ['add','edit']) {
    const input=$(`#${prefix}-name`);input.addEventListener('input',()=>updateSuggestions(prefix));
    input.addEventListener('keydown',e=>{
      if(e.key==='Escape' && !$(`#${prefix}-suggestions`).hidden){e.preventDefault();e.stopPropagation();closeSuggestions(prefix);return;}
      const suggestions=suggestionState.get(prefix);
      if(['ArrowDown','ArrowUp'].includes(e.key)) {
        e.preventDefault();if(!suggestions){updateSuggestions(prefix);}
        const current=suggestionState.get(prefix);if(!current?.entries.length)return;
        current.index=e.key==='ArrowDown'?(current.index+1)%current.entries.length:(current.index<0?current.entries.length-1:(current.index+current.entries.length-1)%current.entries.length);
        [...$(`#${prefix}-suggestions`).children].forEach((option,i)=>option.setAttribute('aria-selected',String(i===current.index)));
        const selected=$(`#${prefix}-suggestions`).children[current.index];input.setAttribute('aria-activedescendant',selected.id);selected.scrollIntoView({block:'nearest'});
      } else if(e.key==='Enter' && suggestions?.index>=0){e.preventDefault();pickSuggestion(prefix,suggestions.index);}
    });input.addEventListener('blur',()=>closeSuggestions(prefix));
  }
  document.addEventListener('pointerdown',e=>{if(!e.target.closest('.name-field'))closeSuggestions();});
  // Второй click одного двойного нажатия не отправляет уже очищенную форму.
  document.addEventListener('click',e=>{if(e.detail>1 && e.target.closest('.add-button') && !normalize($('#add-name').value))e.preventDefault();},true);
  function blockConflict() {
    locked=true;lockReason='conflict';clearUndo();closeSuggestions();$('#notification').hidden=true;
    if(!$('#conflict-dialog').open)openDialog($('#conflict-dialog'));$('#refresh-data').focus();
  }
  function protect(reason,text) {
    for(const d of [...document.querySelectorAll('dialog[open]')].reverse())closeDialog(d);
    locked=true;lockReason=reason;state=emptyState();clearUndo();closeSuggestions();$('#notification').hidden=true;
    $('#storage-error').hidden=true;$('#quota-actions').hidden=true;$('#data-protection').hidden=false;$('#protection-text').textContent=text;$('#reset-data').hidden=reason==='read';render();
  }
  function resetView() {
    for(const d of [...document.querySelectorAll('dialog[open]')].reverse())closeDialog(d);
    clearUndo();clearTimeout(noticeTimer);closeSuggestions();suspendedDraft=null;pendingCatalogName=null;editingId=null;confirmation=null;
    section='current';filter='all';historyFilter='all';selectedHistory=null;$('#catalog-search').value='';
    $('#add-form').reset();$('#item-form').reset();$('#trip-form').reset();clearFields(['add-name','add-quantity','edit-name','edit-quantity','trip-name','trip-date-input']);$('#notification').hidden=true;
  }
  function loadState(reset=false) {
    let raw;
    try{raw=localStorage.getItem(KEY);}catch{protect('read','Не удалось получить доступ к хранилищу браузера. Проверьте настройки и попробуйте снова. Данные не изменены.');return;}
    let loaded;
    original=raw;
    try{loaded=raw===null?{state:emptyState(),migrated:false}:migrateState(JSON.parse(raw));}
    catch{protect('invalid','Сохранённые данные повреждены или имеют неподдерживаемую версию. Они не перезаписаны. Можно повторить чтение или явно сбросить все данные планировщика.');return;}
    if(loaded.migrated) {
      try{
        loaded.state.revision++;loaded.state.updatedAt=new Date().toISOString();if(!loadValid(loaded.state))throw new Error('invalid');
        if(localStorage.getItem(KEY)!==raw){blockConflict();return;}
        const json=JSON.stringify(loaded.state);localStorage.setItem(KEY,json);original=json;
      }catch{protect('invalid','Не удалось обновить формат данных. Исходная запись сохранена без изменений. Попробуйте снова.');return;}
    }
    if(reset)resetView();state=loaded.state;locked=false;lockReason=null;quotaError=false;
    $('#data-protection').hidden=true;$('#storage-error').hidden=true;$('#quota-actions').hidden=true;render();
    if(raw===null)try{localStorage.setItem(`${KEY}.probe`,'1');localStorage.removeItem(`${KEY}.probe`);}catch(error){quotaError=error.name==='QuotaExceededError';showError('Хранилище браузера недоступно для записи. Изменения не будут сохранены, пока доступ не восстановится.');}
  }
  function goCleanup(target) {
    if(locked)return;
    if(quotaError && $('#item-dialog').open){suspendedDraft={tripId:activeTrip(state).id,itemId:editingId,mode:itemMode,name:$('#edit-name').value,quantity:$('#edit-quantity').value,unit:$('#edit-unit').value};}
    for(const d of [...document.querySelectorAll('dialog[open]')].reverse())closeDialog(d);
    switchSection(target);
  }
  document.querySelectorAll('[data-cleanup]').forEach(button=>button.addEventListener('click',()=>goCleanup(button.dataset.cleanup)));
  $('#resume-draft').addEventListener('click',()=>{
    if(locked || !suspendedDraft)return;const draft=suspendedDraft;
    if(activeTrip(state)?.id!==draft.tripId){suspendedDraft=null;render();return;}
    switchSection('current');itemMode=draft.mode;editingId=draft.itemId;
    $('#item-dialog-title').textContent=itemMode==='edit'?'Изменить покупку':'Добавить покупку';$('#item-form button[type=submit]').textContent=itemMode==='edit'?'Сохранить':'Добавить';
    $('#edit-name').value=draft.name;$('#edit-quantity').value=draft.quantity;$('#edit-unit').value=draft.unit;clearFields(['edit-name','edit-quantity']);openDialog($('#item-dialog'));
    suspendedDraft=null;$('#resume-draft').hidden=true;
  });
  $('#retry-read').addEventListener('click',()=>loadState(true));$('#refresh-data').addEventListener('click',()=>loadState(true));
  $('#reset-data').addEventListener('click',()=>confirmAction('Сбросить данные?','Все походы и каталог будут удалены без восстановления.','Сбросить данные',()=>{
    try{if(localStorage.getItem(KEY)!==original){blockConflict();return false;}localStorage.removeItem(KEY);loadState(true);return true;}catch{showError('Не удалось сбросить данные. Проверьте доступ к хранилищу и попробуйте снова.');return false;}
  },true));
  window.addEventListener('storage',event=>{
    if(event.key!==KEY && event.key!==null)return;
    try{if(event.storageArea!==localStorage)return;if(localStorage.getItem(KEY)!==original)blockConflict();}
    catch{protect('read','Не удалось прочитать изменение из другой вкладки. Данные не изменены. Попробуйте снова.');}
  });
  let offlineReady=false,deferredInstall=null,installed=false,offlineBusy=false,registration=null;
  const standalone=()=>window.matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  function updateInstallUI(){const already=installed||standalone();$('#install-app').hidden=already||!offlineReady||!deferredInstall;$('#install-help').hidden=already;}
  function offlineError(){offlineReady=false;$('#offline-status').textContent='Не удалось подготовить офлайн-режим. Подключитесь к интернету и попробуйте снова.';$('#retry-offline').hidden=false;updateInstallUI();}
  function askWorker(worker,type='CHECK_OFFLINE') {
    return new Promise(resolve=>{if(!worker){resolve({ready:false});return;}
      const channel=new MessageChannel();const timeout=setTimeout(()=>{channel.port1.close();resolve({ready:false});},3000);
      channel.port1.onmessage=event=>{clearTimeout(timeout);channel.port1.close();resolve(event.data);};
      try{worker.postMessage({type},[channel.port2]);}catch{clearTimeout(timeout);channel.port1.close();resolve({ready:false});}
    });
  }
  async function verifyOffline(){
    const worker=navigator.serviceWorker?.controller;if(!worker)return false;
    const result=await askWorker(worker);
    offlineReady=!!result.ready&&navigator.serviceWorker.controller===worker;
    if(offlineReady){$('#offline-status').textContent='Готово к работе без интернета';$('#retry-offline').hidden=true;}
    else offlineError();updateInstallUI();return offlineReady;
  }
  function watchRegistration(reg){
    if(reg.waiting)$('#update-status').hidden=false;
    const watch=worker=>{if(!worker)return;worker.addEventListener('statechange',()=>{
      if(worker.state==='installed'&&navigator.serviceWorker.controller)$('#update-status').hidden=false;
      if(worker.state==='activated')verifyOffline();
      if(worker.state==='redundant'&&!offlineReady)offlineError();
    });};watch(reg.installing);reg.addEventListener('updatefound',()=>watch(reg.installing));
  }
  async function setupOffline(retry=false){
    $('#offline-panel').hidden=false;$('#network-status').hidden=navigator.onLine;updateInstallUI();
    if(location.protocol==='file:'){$('#offline-status').textContent='Для офлайн-запуска нужна HTTPS-ссылка';$('#file-notice').hidden=false;$('#retry-offline').hidden=true;return;}
    if(!window.isSecureContext||!('serviceWorker' in navigator)){$('#offline-status').textContent='Повторный запуск без интернета в этом браузере недоступен. Откройте HTTPS-ссылку в современном браузере.';$('#retry-offline').hidden=true;return;}
    if(offlineBusy)return;offlineBusy=true;
    if(!offlineReady)$('#offline-status').textContent='Подготавливаем работу без интернета';$('#retry-offline').disabled=true;
    let deadline;
    try{
      if(navigator.serviceWorker.controller)await verifyOffline();
      registration=await navigator.serviceWorker.register('./sw.js',{scope:'./',updateViaCache:'none'});watchRegistration(registration);
      if(navigator.serviceWorker.controller){
        const ready=await verifyOffline();
        if(retry&&!ready&&!registration.waiting){await askWorker(navigator.serviceWorker.controller,'PREPARE_OFFLINE');await verifyOffline();}
      }
      if(retry)await registration.update();
      if(!offlineReady){deadline=setTimeout(()=>{if(!offlineReady)offlineError();},12000);navigator.serviceWorker.ready.then(()=>{clearTimeout(deadline);verifyOffline();});}
    }catch{if(!offlineReady)offlineError();}
    finally{offlineBusy=false;$('#retry-offline').disabled=false;}
  }
  window.addEventListener('beforeinstallprompt',event=>{event.preventDefault();deferredInstall=event;updateInstallUI();});
  window.addEventListener('appinstalled',()=>{installed=true;deferredInstall=null;updateInstallUI();});
  window.matchMedia('(display-mode: standalone)').addEventListener('change',updateInstallUI);
  $('#install-app').addEventListener('click',async()=>{
    const event=deferredInstall;if(!event||!offlineReady)return;deferredInstall=null;updateInstallUI();
    try{await event.prompt();const choice=await event.userChoice;if(choice.outcome==='accepted')installed=true;}
    catch{notify('Не удалось открыть установку. Посмотрите инструкцию.');openDialog($('#install-dialog'));}
    finally{updateInstallUI();}
  });
  $('#install-help').addEventListener('click',()=>openDialog($('#install-dialog')));
  $('#retry-offline').addEventListener('click',()=>setupOffline(true));
  window.addEventListener('online',()=>{$('#network-status').hidden=true;if(!offlineReady)setupOffline(true);});
  window.addEventListener('offline',()=>{$('#network-status').hidden=false;});
  if('serviceWorker' in navigator){
    navigator.serviceWorker.addEventListener('controllerchange',verifyOffline);
    navigator.serviceWorker.addEventListener('message',event=>{
      if(event.source!==navigator.serviceWorker.controller)return;
      if(event.data?.type==='OFFLINE_UNAVAILABLE')offlineError();
      if(event.data?.type==='VERSION_MISMATCH'){offlineError();registration?.update().catch(()=>{});}
    });
  }
  state=emptyState();original=null;loadState();setupOffline();
})();
