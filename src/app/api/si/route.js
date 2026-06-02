import { NextResponse } from 'next/server';
import { dispatchAction } from '../../../server/si/_router.js';

export const runtime = 'nodejs';

function safeMessage(err) {
  if (!err) return 'Unknown error';
  if (typeof err === 'string') return err;
  return err?.message ? String(err.message) : 'Unknown error';
}

function inferErrorCode(msg) {
  const lower = String(msg || '').toLowerCase();
  if (
    lower.includes('unauthorized') ||
    lower.includes('not authenticated') ||
    lower.includes('invalid session') ||
    lower.includes('invalid token') ||
    lower.includes('invalid username') ||
    lower.includes('account is disabled')
  ) {
    return 'UNAUTHENTICATED';
  }
  if (lower.includes('missing') || lower.includes('required') || lower.includes('bad request')) return 'BAD_REQUEST';
  return 'SERVER_ERROR';
}

function jsonOk(data) {
  return NextResponse.json({ ok: true, data: data || {} });
}

function jsonError(code, message) {
  const status = code === 'SERVER_ERROR' ? 500 : code === 'NOT_FOUND' ? 404 : code === 'UNAUTHENTICATED' ? 401 : 400;
  return NextResponse.json({ ok: false, error: { code: String(code || 'UNKNOWN'), message: String(message || '') } }, { status });
}

export async function GET(request) {
  try {
    const url = new URL(request.url);
    const sp = url.searchParams;
    const action = String(sp.get('action') || '');
    const token = String(sp.get('token') || '');
    const session = String(sp.get('session') || '');
    if (!action) return jsonError('BAD_REQUEST', 'Missing action');
    const payload = Object.fromEntries(sp.entries());
    delete payload.action;
    delete payload.token;
    delete payload.session;
    const data = await dispatchAction({ action, token, session, payload });
    return jsonOk(data);
  } catch (err) {
    const msg = safeMessage(err);
    return jsonError(inferErrorCode(msg), msg);
  }
}

export async function POST(request) {
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    const action = body?.action ? String(body.action) : '';
    const token = body?.token ? String(body.token) : '';
    const session = body?.session ? String(body.session) : '';
    if (!action) return jsonError('BAD_REQUEST', 'Missing action');
    const payload = body?.payload ?? {};
    const data = await dispatchAction({ action, token, session, payload });
    return jsonOk(data);
  } catch (err) {
    const msg = safeMessage(err);
    return jsonError(inferErrorCode(msg), msg);
  }
}
