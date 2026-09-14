import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';

const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const stable = (value) => value && typeof value === 'object' && !Array.isArray(value)
  ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`
  : Array.isArray(value) ? `[${value.map(stable).join(',')}]` : JSON.stringify(value);

function keyFor(sheet, row, sourceRow) {
  const first = (...keys) => keys.map((key) => String(row[key] ?? '').trim()).find(Boolean) || '';
  if (sheet === 'Inventory') return first('Product');
  if (sheet === 'Products') return first('Name', 'Product');
  if (sheet === 'Users') return first('Username').toLowerCase();
  if (sheet === 'Inventory_History') return `${first('Date')}|${first('Product')}`;
  if (sheet === 'Sales_Finance') return first('Date');
  if (sheet === 'Needs_Replenish') return `${first('Date')}|${first('Product')}|${first('Status')}`;
  if (sheet === 'Attendance') return `${first('Date')}|${first('Staff')}`;
  return first('Key', 'Name') || `row:${sourceRow}`;
}

function cellValue(value) {
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === 'object') {
    if ('result' in value) return cellValue(value.result);
    if ('text' in value) return String(value.text);
    if ('richText' in value) return value.richText.map((part) => part.text).join('');
  }
  return value ?? '';
}

export async function readWorkbook(file) {
  const sourceFile = path.resolve(file);
  const bytes = fs.readFileSync(sourceFile);
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(bytes);
  const sheets = book.worksheets.filter((worksheet) => worksheet.state !== 'veryHidden').map((worksheet) => {
    const headers = [];
    worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, column) => { headers[column - 1] = String(cellValue(cell.value)).trim(); });
    const records = [];
    worksheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
      if (rowNumber === 1) return;
      const cells = headers.map((_, column) => cellValue(row.getCell(column + 1).value));
      if (!cells.some((cell) => cell !== '' && cell != null)) return;
      const raw = {};
      headers.forEach((header, column) => { if (header) raw[header] = cells[column]; });
      const logicalKey = keyFor(worksheet.name, raw, rowNumber);
      records.push({ sourceRow: rowNumber, raw, logicalKey, fingerprint: digest(stable(raw)) });
    });
    return { name: worksheet.name, headers, records };
  });
  return { sourceFile, workbookHash: digest(bytes), sheets };
}

export function profileWorkbook(workbook) {
  const records = [];
  const duplicates = [];
  for (const sheet of workbook.sheets) {
    const seen = new Map();
    for (const record of sheet.records) {
      let disposition = record.logicalKey ? 'loaded' : 'quarantined';
      let reason = disposition === 'loaded' ? null : 'missing-logical-key';
      if (record.logicalKey && seen.has(record.logicalKey)) {
        disposition = 'quarantined'; reason = 'duplicate-logical-key'; duplicates.push({ sheet: sheet.name, key: record.logicalKey });
      }
      seen.set(record.logicalKey, record.sourceRow);
      records.push({ sheetName: sheet.name, ...record, disposition, reason });
    }
  }
  const dispositions = records.reduce((all, row) => ({ ...all, [row.disposition]: (all[row.disposition] || 0) + 1 }), {});
  return {
    workbookHash: workbook.workbookHash,
    sourceFile: workbook.sourceFile,
    sheetCount: workbook.sheets.length,
    rowCount: records.length,
    bySheet: Object.fromEntries(workbook.sheets.map((sheet) => [sheet.name, sheet.records.length])),
    dispositions,
    duplicates,
    records,
  };
}
