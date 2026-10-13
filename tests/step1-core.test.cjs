const {test} = require('node:test');
const assert = require('node:assert/strict');
const core = require('../script.js');

test('Нормализация Unicode, пробелов и регистра; е и ё различаются', () => {
  assert.equal(core.normalize('  Молоко\n  свежее  '), 'Молоко свежее');
  assert.equal(core.nameKey(' МОЛОКО '), core.nameKey('молоко'));
  assert.equal(core.normalize('и\u0306'), 'й');
  assert.notEqual(core.nameKey('мед'), core.nameKey('мёд'));
});
test('Количество: границы, запятая, точка и точная сумма', () => {
  for (const [raw,value] of [['0,001',0.001],['999999.999',999999.999],['0.1',0.1],['001,50',1.5]]) assert.equal(core.parseQuantity(raw),value);
  assert.equal(core.sumQuantity(0.1,0.2),0.3);
  assert.equal(core.sumQuantity(999999.998,0.001),999999.999);
});
test('Количество: неверные записи и переполнение отвергаются', () => {
  for (const raw of ['', '0', '-1', '+1', '1e3', 'NaN', 'Infinity', '1,2.3', '0.0001', '1000000', '1.', '99999999999999999999999']) assert.throws(()=>core.parseQuantity(raw),undefined,raw);
  assert.throws(()=>core.sumQuantity(999999.999,0.001));
});
test('Даты: реальные дни, високосность и диапазон', () => {
  for (const date of ['1900-01-01','2100-12-31','2024-02-29','2026-10-13']) assert.equal(core.validDate(date),true,date);
  for (const date of ['1899-12-31','2101-01-01','2026-02-29','2026-04-31','2026-13-01','2026-00-01','2026-10-00','13.10.2026','']) assert.equal(core.validDate(date),false,date);
});
function state() {
  const s=core.emptyState();s.trips.push({id:'trip',name:'Поход',date:'2026-10-13',status:'active',items:[]});return s;
}
test('Повторное добавление объединяет только ту же единицу и снимает покупку', () => {
  const s=state();core.addItem(s,'trip',{name:'Молоко',quantity:0.1,unit:'л'});
  const item=s.trips[0].items[0];const id=item.id;item.purchased=true;
  assert.equal(core.addItem(s,'trip',{name:'молоко',quantity:0.2,unit:'л'}),true);
  assert.equal(item.quantity,0.3);assert.equal(item.id,id);assert.equal(item.purchased,false);assert.equal(item.name,'Молоко');
  core.addItem(s,'trip',{name:'Молоко',quantity:1,unit:'уп.'});
  assert.equal(s.trips[0].items.length,2);assert.equal(s.catalog.length,1);
});
test('Редактирование и подтверждённое объединение', () => {
  const s=state();core.addItem(s,'trip',{name:'Хлеб',quantity:1,unit:'шт.'});core.addItem(s,'trip',{name:'Булка',quantity:2,unit:'шт.'});
  const [a,b]=s.trips[0].items;a.purchased=true;
  core.editItem(s,'trip',a.id,{name:'Хлеб ржаной',quantity:3,unit:'шт.'},false);
  assert.equal(a.purchased,true);assert.equal(s.catalog.length,3);
  assert.throws(()=>core.editItem(s,'trip',a.id,{name:'Булка',quantity:3,unit:'шт.'},false));
  core.editItem(s,'trip',a.id,{name:'Булка',quantity:3,unit:'шт.'},true);
  assert.equal(s.trips[0].items.length,1);assert.equal(b.quantity,5);assert.equal(b.purchased,false);assert.equal(b.order,1);
});
test('Переполнение не меняет товары и каталог', () => {
  const s=state();core.addItem(s,'trip',{name:'Товар',quantity:999999.999,unit:'кг'});const before=JSON.stringify(s);
  assert.throws(()=>core.addItem(s,'trip',{name:'товар',quantity:0.001,unit:'кг'}));assert.equal(JSON.stringify(s),before);
});
test('Базовая защита текущего формата загрузки', () => {
  assert.equal(core.loadValid(core.emptyState()),true);
  for (const s of [null,{}, {...core.emptyState(),schemaVersion:2},{...core.emptyState(),revision:-1}]) assert.equal(core.loadValid(s),false);
  const s=state();s.trips.push({...s.trips[0],id:'other'});assert.equal(core.loadValid(s),false);
});
