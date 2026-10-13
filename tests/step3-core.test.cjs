const {test}=require('node:test');const assert=require('node:assert/strict');const c=require('../script.js');
function fixture(){const s=c.emptyState(),t=c.newTrip('Поход','2026-10-13');s.trips.push(t);c.addItem(s,t.id,{name:'Молоко',quantity:0.1,unit:'л'});return s;}
test('Текущая схема читается без преобразования и мутации',()=>{const s=fixture(),raw=JSON.stringify(s),result=c.migrateState(s);assert.equal(result.state,s);assert.equal(result.migrated,false);assert.equal(JSON.stringify(s),raw);assert.ok(c.loadValid(s));});
const invalidCases={
  'null':()=>null,'неизвестная версия':s=>({...s,schemaVersion:2}),'старая версия без миграции':s=>({...s,schemaVersion:0}),
  'лишнее поле':s=>({...s,extra:true}),'отсутствующее поле':s=>{delete s.updatedAt;return s;},'неверная метка времени':s=>({...s,updatedAt:'2026-02-30'}),
  'несколько текущих':s=>{s.trips.push({...s.trips[0],id:'second',items:[]});return s;},'дубликат ID похода':s=>{s.trips.push({...s.trips[0]});return s;},
  'дубликат ID товара':s=>{s.trips[0].items.push({...s.trips[0].items[0],name:'Хлеб',order:1});return s;},
  'дубликат ID каталога':s=>{s.catalog.push({...s.catalog[0],name:'Хлеб'});return s;},'дубликат названия каталога':s=>{s.catalog.push({id:'other',name:'молоко'});return s;},
  'дубликат пары товара':s=>{s.trips[0].items.push({...s.trips[0].items[0],id:'other',name:'молоко',order:1});return s;},
  'дубликат порядка':s=>{s.trips[0].items.push({...s.trips[0].items[0],id:'other',name:'Хлеб'});return s;},
  'отрицательный порядок':s=>{s.trips[0].items[0].order=-1;return s;},'лишняя точность':s=>{s.trips[0].items[0].quantity=0.0001;return s;},
  'количество строкой':s=>{s.trips[0].items[0].quantity='1';return s;},'NaN':s=>{s.trips[0].items[0].quantity=NaN;return s;},
  'неверная единица':s=>{s.trips[0].items[0].unit='тонна';return s;},'статус покупки числом':s=>{s.trips[0].items[0].purchased=1;return s;},
  'пустое название':s=>{s.catalog[0].name='';return s;},'ненормализованное название':s=>{s.trips[0].name=' Поход ';return s;},
  'некалендарная дата':s=>{s.trips[0].date='2026-02-29';return s;},'revision отрицательный':s=>({...s,revision:-1}),
  'текущий с completedAt':s=>{s.trips[0].completedAt=s.updatedAt;return s;},'архив без даты завершения':s=>{s.trips[0].status='completed';return s;},
  'manual с количеством переноса':s=>{c.completeTrip(s,s.trips[0].id);s.trips[0].transferredItemCount=1;return s;},
  'transfer с некупленным в архиве':s=>{c.completeTrip(s,s.trips[0].id,'transfer',1);return s;},
};
for(const [name,change] of Object.entries(invalidCases))test(`Повреждённые данные: ${name}`,()=>{const s=change(fixture());assert.equal(c.loadValid(s),false);assert.throws(()=>c.migrateState(s));});
test('Перенос и удаление каталога сохраняют допустимую схему',()=>{const s=fixture();c.transferTrip(s,s.trips[0].id,'Новый','2026-10-14');s.catalog=[];assert.ok(c.loadValid(s));});
test('Границы количества и точность двоичного представления принимаются',()=>{const s=fixture();for(const q of [0.001,0.1,0.29,17.137,999999.999]){s.trips[0].items[0].quantity=q;assert.ok(c.loadValid(s),q);}});
test('Оценка размера только своего JSON и ключа',()=>{assert.equal(c.storageBytes(null),0);assert.equal(c.storageBytes(''),2*'shopping-planner.state.v1'.length);assert.equal(c.storageBytes('аб'),2*('shopping-planner.state.v1'.length+2));});
