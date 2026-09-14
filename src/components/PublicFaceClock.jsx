'use client';

import { useEffect, useRef, useState } from 'react';
import { Clock3 } from 'lucide-react';
import { apiPost } from '../lib/apiClient.js';
import { scanFace } from '../lib/browserFace.js';

export default function PublicFaceClock({ compact = false }) {
  const videoRef = useRef(null); const streamRef = useRef(null);
  const [ready, setReady] = useState(false); const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(''); const [error, setError] = useState('');
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  async function startCamera() {
    setError(''); setMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      streamRef.current?.getTracks().forEach((track) => track.stop()); streamRef.current = stream;
      videoRef.current.srcObject = stream; await videoRef.current.play(); setReady(true);
    } catch { setError('Allow camera access. Camera requires HTTPS or localhost.'); }
  }

  async function clock(eventType) {
    setBusy(true); setError(''); setMessage('Loading face model and scanning…');
    try {
      const descriptor = await scanFace(videoRef.current);
      const result = await apiPost('face.clock', { descriptor, eventType, deviceLabel: navigator.userAgent.slice(0, 100) });
      const label = eventType === 'CHECK_IN' ? 'TIME IN' : 'TIME OUT';
      setMessage(result.recorded ? `${label} recorded for ${result.staff}.` : `${result.staff}: ${label} is not valid after the previous clock event.`);
    } catch (reason) { setMessage(''); setError(reason.message || 'Face was not recognized'); } finally { setBusy(false); }
  }

  return (
    <section className="md-card-elevated p-4">
      <div className="flex items-center gap-2"><Clock3 size={18} className="text-[var(--p-5)]" /><div className="font-extrabold">Staff Face Clock</div></div>
      {error ? <div className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="mt-3 rounded-lg bg-emerald-50 p-2 text-sm font-semibold text-emerald-800">{message}</div> : null}
      <div className={`${compact ? 'max-w-[220px]' : 'max-w-[300px]'} relative mx-auto mt-4 aspect-[3/4] w-full overflow-hidden rounded-[50%] border-4 border-white bg-slate-900 shadow-[0_0_0_3px_rgba(225,51,72,0.28),0_16px_40px_rgba(15,23,42,0.22)]`}>
        <video ref={videoRef} muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
        {!ready ? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-900/25 px-8 text-center text-xs font-semibold text-white">Position your face inside the frame</div> : null}
        <div className="pointer-events-none absolute inset-[10%] rounded-[50%] border border-dashed border-white/65" aria-hidden="true" />
      </div>
      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
        <button type="button" className="md-btn md-btn-outline" onClick={startCamera} disabled={busy}>Start Camera</button>
        <button type="button" className="md-btn bg-emerald-600 text-white hover:bg-emerald-700" onClick={() => clock('CHECK_IN')} disabled={!ready || busy}>{busy ? 'Scanning…' : 'TIME IN'}</button>
        <button type="button" className="md-btn bg-amber-500 text-white hover:bg-amber-600" onClick={() => clock('CHECK_OUT')} disabled={!ready || busy}>{busy ? 'Scanning…' : 'TIME OUT'}</button>
      </div>
    </section>
  );
}
