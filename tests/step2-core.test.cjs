const {test}=require('node:test');
const assert=require('node:assert/strict');
const core=require('../script.js');
function state(){const s=core.emptyState();s.trips.push(core.newTrip('Первый поход','2026-10-13'));return s;}
test('Перенос сохраняет ID, количество и порядок; завершает источник',()=>{
  const s=state(),t=s.trips[0];
  core.addItem(s,t.id,{name:'Хлеб',quantity:1,unit:'шт.'});core.addItem(s,t.id,{name:'Молоко',quantity:2,unit:'л'});core.addItem(s,t.id,{name:'Яблоки',quantity:0.5,unit:'кг'});
  t.items[0].purchased=true;const remaining=structuredClone(t.items.slice(1)),catalog=JSON.stringify(s.catalog);
  core.transferTrip(s,t.id,'Следующий','2026-10-14');
  assert.equal(t.status,'completed');assert.equal(t.completionReason,'transfer');assert.equal(t.transferredItemCount,2);assert.equal(t.items.length,1);assert.equal(t.items[0].name,'Хлеб');
  assert.deepEqual(s.trips[1].items,remaining.map((i,order)=>({...i,order})));assert.equal(s.trips.filter(t=>t.status==='active').length,1);assert.equal(JSON.stringify(s.catalog),catalog);
});
test('Все некупленные: пустой архив и непустой следующий поход',()=>{
  const s=state(),t=s.trips[0];core.addItem(s,t.id,{name:'Хлеб',quantity:1,unit:'шт.'});core.transferTrip(s,t.id,'Следующий','2026-10-14');
  assert.equal(t.items.length,0);assert.equal(t.transferredItemCount,1);assert.equal(s.trips[1].items.length,1);
});
test('Нет некупленных и повторный перенос не изменяют данные',()=>{
  const s=state(),t=s.trips[0];const before=JSON.stringify(s);assert.throws(()=>core.transferTrip(s,t.id,'Новый','2026-10-14'));assert.equal(JSON.stringify(s),before);
  core.addItem(s,t.id,{name:'Хлеб',quantity:1,unit:'шт.'});core.transferTrip(s,t.id,'Новый','2026-10-14');const moved=JSON.stringify(s);
  assert.throws(()=>core.transferTrip(s,t.id,'Ещё один','2026-10-14'));assert.equal(JSON.stringify(s),moved);
});
test('Ручное завершение сохраняет некупленные; новый поход не создаётся',()=>{
  const s=state(),t=s.trips[0];core.addItem(s,t.id,{name:'Хлеб',quantity:1,unit:'шт.'});const items=JSON.stringify(t.items);core.completeTrip(s,t.id);
  assert.equal(t.status,'completed');assert.equal(t.completionReason,'manual');assert.equal(t.transferredItemCount,0);assert.equal(JSON.stringify(t.items),items);assert.equal(s.trips.length,1);assert.ok(t.completedAt);
});
test('Пустой поход можно завершить; старый ID нельзя завершить повторно',()=>{
  const s=state(),t=s.trips[0];core.completeTrip(s,t.id);assert.equal(t.items.length,0);assert.throws(()=>core.completeTrip(s,t.id));
});
test('Каталог: подстрока, регистр, пробелы, алфавит',()=>{
  const s=state();for(const name of ['Яблоки','Молоко','Бананы','Молоко сухое'])core.addItem(s,s.trips[0].id,{name,quantity:1,unit:'шт.'});
  assert.deepEqual(core.sortedCatalog(s,'  МОЛОКО ').map(c=>c.name),['Молоко','Молоко сухое']);assert.deepEqual(core.sortedCatalog(s).map(c=>c.name),['Бананы','Молоко','Молоко сухое','Яблоки']);
});
test('История сортируется по завершению, созданию, затем ID',()=>{
  const s=core.emptyState();s.trips=[{id:'a',status:'completed',completedAt:'2026-10-12',createdAt:'2026-10-12'},{id:'z',status:'completed',completedAt:'2026-10-13',createdAt:'2026-10-12'},{id:'c',status:'completed',completedAt:'2026-10-13',createdAt:'2026-10-13'},{id:'b',status:'completed',completedAt:'2026-10-13',createdAt:'2026-10-13'},{id:'active',status:'active'}];
  assert.deepEqual(core.sortedHistory(s).map(t=>t.id),['b','c','z','a']);
});
