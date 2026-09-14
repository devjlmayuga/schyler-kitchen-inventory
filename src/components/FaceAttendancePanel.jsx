'use client';

import { useEffect, useRef, useState } from 'react';
import { apiGet, apiPost } from '../lib/apiClient.js';
import { scanFace } from '../lib/browserFace.js';

export default function FaceAttendancePanel({ staff = [], onRecorded }) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const [selectedStaff, setSelectedStaff] = useState(staff[0] || '');
  const [consent, setConsent] = useState(false);
  const [profiles, setProfiles] = useState([]);
  const [cameraReady, setCameraReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => { if (!selectedStaff && staff[0]) setSelectedStaff(staff[0]); }, [selectedStaff, staff]);
  useEffect(() => () => streamRef.current?.getTracks().forEach((track) => track.stop()), []);

  async function loadProfiles() {
    try { setProfiles((await apiGet('face.profiles')).profiles || []); } catch (reason) { setError(reason.message); }
  }
  useEffect(() => { loadProfiles(); }, []);

  async function startCamera() {
    setError(''); setMessage('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 640, height: 480 }, audio: false });
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = stream;
      videoRef.current.srcObject = stream;
      await videoRef.current.play();
      setCameraReady(true);
    } catch { setError('Camera access was denied or is unavailable. Use HTTPS or localhost and allow camera access.'); }
  }

  async function captureDescriptor() {
    if (!cameraReady || !videoRef.current) throw new Error('Start the camera first');
    return scanFace(videoRef.current);
  }

  async function enroll() {
    if (!selectedStaff) return setError('Select a staff member');
    if (!consent) return setError('Confirm recorded staff consent before enrollment');
    setBusy(true); setError(''); setMessage('Loading face model and scanning…');
    try {
      const descriptor = await captureDescriptor();
      await apiPost('face.enroll', { staff: selectedStaff, descriptor, consent: true });
      setMessage(`${selectedStaff} enrolled successfully. No photo was stored.`); setConsent(false); await loadProfiles();
    } catch (reason) { setError(reason.message || 'Enrollment failed'); setMessage(''); } finally { setBusy(false); }
  }

  async function checkIn() {
    setBusy(true); setError(''); setMessage('Loading face model and scanning…');
    try {
      const descriptor = await captureDescriptor();
      const result = await apiPost('face.checkIn', { descriptor, deviceLabel: navigator.userAgent.slice(0, 100) });
      setMessage(result.duplicate ? `${result.staff} already checked in recently.` : `Welcome, ${result.staff}. Check-in recorded.`);
      if (!result.duplicate) Promise.resolve(onRecorded?.()).catch(() => {});
    } catch (reason) { setError(reason.message || 'Face was not recognized'); setMessage(''); } finally { setBusy(false); }
  }

  async function remove(staffName) {
    if (!window.confirm(`Remove face enrollment for ${staffName}?`)) return;
    setBusy(true); setError('');
    try { await apiPost('face.remove', { staff: staffName }); await loadProfiles(); setMessage(`${staffName} face enrollment removed.`); }
    catch (reason) { setError(reason.message); } finally { setBusy(false); }
  }

  return (
    <div className="md-card p-4">
      <div className="text-sm font-semibold">Face Attendance (Free Browser Mode)</div>
      <p className="mt-1 text-xs text-slate-600">Recognition runs in this browser. Neon stores only an encrypted numerical descriptor and check-in events—never camera photos.</p>
      {error ? <div className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div> : null}
      {message ? <div className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{message}</div> : null}
      <div className="mt-4 grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.8fr)]">
        <div>
          <div className="relative mx-auto aspect-[3/4] w-full max-w-[300px] overflow-hidden rounded-[50%] border-4 border-white bg-slate-900 shadow-[0_0_0_3px_rgba(225,51,72,0.28),0_16px_40px_rgba(15,23,42,0.22)]">
            <video ref={videoRef} muted playsInline className="h-full w-full scale-x-[-1] object-cover" />
            {!cameraReady ? <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-900/25 px-8 text-center text-xs font-semibold text-white">Position your face inside the frame</div> : null}
            <div className="pointer-events-none absolute inset-[10%] rounded-[50%] border border-dashed border-white/65" aria-hidden="true" />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button type="button" className="md-btn md-btn-outline" onClick={startCamera} disabled={busy}>Start Camera</button>
            <button type="button" className="md-btn md-btn-primary" onClick={checkIn} disabled={busy || !cameraReady}>{busy ? 'Scanning…' : 'Face Check In'}</button>
          </div>
        </div>
        <div className="space-y-3">
          <label className="md-field"><span className="md-label">Enroll staff</span><select className="md-input" value={selectedStaff} onChange={(event) => setSelectedStaff(event.target.value)}><option value="">Select staff</option>{staff.map((name) => <option key={name}>{name}</option>)}</select></label>
          <label className="flex items-start gap-2 text-xs text-slate-700"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} className="mt-0.5" /><span>I confirm this staff member gave specific consent to face-descriptor processing for attendance and was offered a non-biometric alternative.</span></label>
          <button type="button" className="md-btn md-btn-outline w-full" onClick={enroll} disabled={busy || !cameraReady || !selectedStaff || !consent}>Enroll / Replace Face</button>
          <div className="border-t pt-3 text-xs font-semibold text-slate-600">Enrolled staff</div>
          {profiles.length ? profiles.map((profile) => <div key={profile.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-3 py-2 text-sm"><span>{profile.staff}</span><button type="button" onClick={() => remove(profile.staff)} className="text-xs font-semibold text-red-600" disabled={busy}>Remove</button></div>) : <div className="text-sm text-slate-500">No face profiles enrolled.</div>}
        </div>
      </div>
    </div>
  );
}
