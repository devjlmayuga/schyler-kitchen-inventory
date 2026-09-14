import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { profileWorkbook, readWorkbook } from '../db/workbook.js';

test('the backup workbook is fully and repeatably profiled without modification', async () => {
  const workbook = fs.existsSync('Takoyaki Simple Inventory.xlsx')
    ? 'Takoyaki Simple Inventory.xlsx'
    : 'Takoyaki Simple Inventory latest.xlsx';
  const before = fs.statSync(workbook).mtimeMs;
  const first = profileWorkbook(await readWorkbook(workbook));
  const second = profileWorkbook(await readWorkbook(workbook));
  assert.equal(first.sheetCount, 8);
  assert.equal(first.dispositions.loaded, first.rowCount);
  assert.ok(first.rowCount > 0);
  assert.deepEqual(first, second);
  assert.equal(fs.statSync(workbook).mtimeMs, before);
});
