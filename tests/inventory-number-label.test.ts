import assert from "node:assert/strict";
import test from "node:test";
import { inventoryNumberLabel } from "../lib/inventory-number-label";
const item = { name: 'кабина звукоизоляционная акустическая №2417/0315 от 08.08.2025', inventoryNumber: 'TMP-2026-2327E74FEEDF5F4B9C08' };
test('temporary list number comes from the single marked inventory number, excluding the date', () => {
  assert.equal(inventoryNumberLabel(item), '2417/0315');
  assert.equal(inventoryNumberLabel({...item, name: 'Монитор инв. № 1350 / 15721'}), '1350 / 15721');
  assert.equal(inventoryNumberLabel({...item, name: 'Моноблок No24130548'}), '24130548');
});
test('official and local group numbers keep their saved identity', () => {
  assert.equal(inventoryNumberLabel({...item, inventoryNumber:'001/000123'}), '001/000123');
  assert.equal(inventoryNumberLabel({...item, localGroupId:'group'}), item.inventoryNumber);
});
test('models, dates, unmarked numbers, conflicting identifiers and ranges cannot replace a temporary number', () => {
  for (const name of ['Lenovo 24130548', 'от 08.08.2025', 'HP123456', 'Стол 1500*1500*500', '№2417/0315 №2417/0316', '№206/1832-1837', '№050-0002060-63']) {
    assert.equal(inventoryNumberLabel({...item,name}), item.inventoryNumber, name);
  }
});

test('all reported No, unmarked slash and absent-number examples resolve identically', () => {
  for (const [name, expected] of [
    ['стол прист д/ перег.No125/00134 02.04.10 канцелярия', '125/00134'],
    ['Кронштейн ONKRON стойка черный No1350/15814 от 26.03.24', '1350/15814'],
    ['Кронштейн ONKRON стойка черная 1350/15814 от 26.03.24', '1350/15814'],
    ['диван офисный 3-х местный №1350/15892 от 16.08.24', '1350/15892'],
  ]) for (const inventoryNumber of [item.inventoryNumber, '', '-']) {
    assert.equal(inventoryNumberLabel({name,inventoryNumber}), expected, name);
  }
});
