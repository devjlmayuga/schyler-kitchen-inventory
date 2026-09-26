'use client';

import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Printer, X } from 'lucide-react';
import { peso } from '../../lib/sales.js';

export default function PayslipPreview({ payslip, onClose }) {
  const dialog = useRef(null);
  useEffect(() => {
    const target = dialog.current;
    target.showModal();
    return () => target.close();
  }, []);
  const { staff, start, end, days, totals } = payslip;
  return createPortal(
    <div id="payslip-print-root">
      <dialog ref={dialog} className="payslip-dialog" aria-label={`${staff} payslip`} onCancel={onClose}>
        <div className="payslip-controls flex items-center justify-between gap-3 border-b border-slate-200 p-4">
          <h2 className="section-title">Payslip preview</h2>
          <div className="flex gap-2">
            <button className="md-btn md-btn-primary" onClick={() => window.print()}>
              <Printer size={16} />
              Print
            </button>
            <button className="admin-icon-button" onClick={onClose} aria-label="Close payslip">
              <X size={18} />
            </button>
          </div>
        </div>
        <article className="payslip-sheet">
          <header className="flex flex-wrap justify-between gap-4 border-b-2 border-[var(--p-3)] pb-5">
            <div>
              <p className="text-lg font-bold">Schyler’s Kitchen</p>
              <h1 className="mt-1 text-sm uppercase tracking-widest text-slate-500">Staff payslip</h1>
            </div>
            <div className="text-sm">
              <p className="font-semibold">{staff}</p>
              <p className="mt-1 text-slate-600">
                {start} – {end}
              </p>
            </div>
          </header>
          <div className="my-6 grid grid-cols-3 gap-3 text-sm">
            <div>
              <p className="text-slate-500">Days worked</p>
              <p className="mt-1 text-lg font-semibold">{totals.days}</p>
            </div>
            <div>
              <p className="text-slate-500">Quota days</p>
              <p className="mt-1 text-lg font-semibold">{totals.quotaDays}</p>
            </div>
            <div>
              <p className="text-slate-500">Overtime hours</p>
              <p className="mt-1 text-lg font-semibold">{totals.overtimeHours}</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="payslip-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Duty</th>
                  <th>Base pay</th>
                  <th>Quota bonus</th>
                  <th>Overtime</th>
                  <th>Total</th>
                </tr>
              </thead>
              <tbody>
                {days.map((day) => (
                  <tr key={day.date}>
                    <td>{day.date}</td>
                    <td>{day.onDuty ? 'Yes' : '—'}</td>
                    <td>{peso(day.base)}</td>
                    <td>{day.quotaHit ? peso(day.bonus) : '—'}</td>
                    <td>
                      {day.overtimeHours ? (
                        <>
                          {peso(day.overtime)}
                          <small>
                            {day.overtimeHours}h × {peso(day.rates.otRate)}
                          </small>
                        </>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td>{peso(day.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <dl className="ml-auto mt-6 max-w-xs space-y-3 text-sm">
            <div className="flex justify-between">
              <dt>Base pay</dt>
              <dd>{peso(totals.base)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Quota bonus</dt>
              <dd>{peso(totals.bonus)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Overtime pay</dt>
              <dd>{peso(totals.overtime)}</dd>
            </div>
            <div className="flex justify-between border-t-2 border-slate-800 pt-3 text-base font-bold">
              <dt>Total earnings</dt>
              <dd>{peso(totals.total)}</dd>
            </div>
          </dl>
          <p className="mt-6 text-xs leading-relaxed text-slate-500">
            Quota bonuses apply on duty days when shop sales exceed the saved daily target. Amounts shown are
            earnings before any deductions.
          </p>
          <div className="mt-14 grid grid-cols-2 gap-10 text-xs text-slate-600">
            <div className="border-t border-slate-400 pt-2">Prepared by</div>
            <div className="border-t border-slate-400 pt-2">Received by / Date</div>
          </div>
        </article>
      </dialog>
    </div>,
    document.body,
  );
}
