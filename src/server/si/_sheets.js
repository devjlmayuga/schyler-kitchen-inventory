import { google } from 'googleapis';

const SCOPES = ['https://www.googleapis.com/auth/spreadsheets'];

function getSpreadsheetId() {
  const id =
    String(process.env.SI_SPREADSHEET_ID || '').trim() ||
    String(process.env.SPREADSHEET_ID || '').trim() ||
    String(process.env.GOOGLE_SHEETS_SPREADSHEET_ID || '').trim();
  if (!id) throw new Error('Missing SI_SPREADSHEET_ID environment variable');
  return id;
}

function getServiceAccountJson() {
  const raw = String(process.env.SI_GOOGLE_SERVICE_ACCOUNT_JSON || '').trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error('SI_GOOGLE_SERVICE_ACCOUNT_JSON must be valid JSON');
  }
}

function getServiceAccountJsonBase64() {
  const raw = String(process.env.SI_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 || '').trim();
  if (!raw) return null;
  try {
    const text = Buffer.from(raw, 'base64').toString('utf8');
    return JSON.parse(text);
  } catch {
    throw new Error('SI_GOOGLE_SERVICE_ACCOUNT_JSON_BASE64 must be base64 of a JSON credentials file');
  }
}

export function getAuthDebugInfo() {
  const spreadsheetId = getSpreadsheetId();
  const json = getServiceAccountJson() || getServiceAccountJsonBase64();
  return {
    spreadsheetId,
    authMode: json ? 'service_account_json' : 'adc',
    serviceAccountEmail: json?.client_email ? String(json.client_email) : null,
  };
}

let _sheetsClient = null;

async function getSheetsClient() {
  if (_sheetsClient) return _sheetsClient;

  const json = getServiceAccountJson() || getServiceAccountJsonBase64();
  if (!json) {
    // Fallback: googleapis can also use ADC (GOOGLE_APPLICATION_CREDENTIALS, etc).
    const auth = new google.auth.GoogleAuth({ scopes: SCOPES });
    const client = await auth.getClient();
    _sheetsClient = google.sheets({ version: 'v4', auth: client });
    return _sheetsClient;
  }

  const auth = new google.auth.JWT({
    email: json.client_email,
    key: json.private_key,
    scopes: SCOPES,
  });
  _sheetsClient = google.sheets({ version: 'v4', auth });
  return _sheetsClient;
}

function colToA1(colNumber) {
  let n = Number(colNumber || 0);
  if (!n || n < 1) return 'A';
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export async function getSheetTitles() {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const list = res?.data?.sheets || [];
  return list.map((s) => String(s?.properties?.title || '')).filter(Boolean);
}

export async function ensureSheet({ title, headers }) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();

  const res = await sheets.spreadsheets.get({ spreadsheetId, fields: 'sheets.properties' });
  const props = res?.data?.sheets?.map((s) => s?.properties) || [];
  const exists = props.some((p) => String(p?.title || '') === title);
  if (!exists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title,
              },
            },
          },
        ],
      },
    });
  }

  if (headers && headers.length) {
    await ensureHeaders(title, headers);
  }
}

export async function getHeaders(sheetName) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!1:1` });
  const row = (res?.data?.values && res.data.values[0]) || [];
  return row.map((h) => String(h || '').trim());
}

export async function ensureHeaders(sheetName, required) {
  const existing = await getHeaders(sheetName);
  const missing = (required || []).filter((h) => existing.indexOf(h) < 0);
  if (!missing.length) return existing;
  const next = existing.concat(missing);
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const lastCol = colToA1(next.length);
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${lastCol}1`,
    valueInputOption: 'RAW',
    requestBody: { values: [next] },
  });
  return next;
}

export async function readSheetAsObjects(sheetName) {
  const headers = await getHeaders(sheetName);
  if (!headers.length) return { headers: [], values: [] };
  const lastCol = colToA1(headers.length);
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const res = await sheets.spreadsheets.values.get({ spreadsheetId, range: `${sheetName}!A2:${lastCol}` });
  const rows = res?.data?.values || [];
  const values = rows.map((row) => {
    const obj = {};
    headers.forEach((h, idx) => {
      if (!h) return;
      obj[h] = row[idx] ?? '';
    });
    return obj;
  });
  return { headers, values };
}

export async function overwriteSheetFromObjects(sheetName, headers, rows) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const hdrs = headers || [];
  const values = [hdrs];
  (rows || []).forEach((r) => {
    values.push(hdrs.map((h) => (h in r ? r[h] : '')));
  });
  const lastCol = colToA1(Math.max(1, hdrs.length));
  // Clear a generous range first to avoid leftover data when the sheet shrinks.
  await sheets.spreadsheets.values.clear({ spreadsheetId, range: `${sheetName}!A1:${lastCol}` });
  await sheets.spreadsheets.values.update({
    spreadsheetId,
    range: `${sheetName}!A1:${lastCol}${values.length}`,
    valueInputOption: 'RAW',
    requestBody: { values },
  });
}

export async function appendRows(sheetName, headers, rows) {
  const sheets = await getSheetsClient();
  const spreadsheetId = getSpreadsheetId();
  const hdrs = headers || [];
  const values = (rows || []).map((r) => hdrs.map((h) => (h in r ? r[h] : '')));
  if (!values.length) return;
  const lastCol = colToA1(Math.max(1, hdrs.length));
  await sheets.spreadsheets.values.append({
    spreadsheetId,
    range: `${sheetName}!A1:${lastCol}`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values },
  });
}
