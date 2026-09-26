'use client';
import { useEffect, useRef, useState } from 'react';
import { Pencil, Printer } from 'lucide-react';
import PosModal from './PosModal.jsx';
import ErrorBanner from '../ErrorBanner.jsx';
import { orderNumber } from '../../lib/pos.js';
import { peso } from '../../lib/sales.js';
import { receiptTime } from '../../lib/receipt.js';
import { sendReceipt } from '../../lib/printer.js';

export default function OrderSlip({ order, settings, autoPrint = false, onClose, onEdit }) {
  const paper = useRef(null);
  const started = useRef(false);
  const printLock = useRef(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [height, setHeight] = useState(200);
  const width = Number(settings.paperWidth) === 80 ? 80 : 58;
  useEffect(() => {
    setHeight(Math.max(80, Math.ceil((paper.current.getBoundingClientRect().height * 25.4) / 96) + 8));
  }, [order, width]);
  async function print(system = false) {
    if (printLock.current) return;
    started.current = true;
    printLock.current = true;
    setBusy(true);
    setError('');
    setStatus('');
    try {
      if (system || settings.method === 'system') {
        window.print();
        setStatus('Print dialog opened. Your sale is already saved.');
      } else {
        await sendReceipt(order, settings);
        setStatus('Slip sent to printer. Check the paper before reprinting.');
      }
    } catch (reason) {
      setError(reason.message || 'Printing failed. Your sale is already saved.');
    } finally {
      printLock.current = false;
      setBusy(false);
    }
  }
  useEffect(() => {
    if (!autoPrint || started.current) return;
    const timer = setTimeout(() => {
      if (started.current) return;
      print();
    }, 200);
    return () => clearTimeout(timer);
  }, [autoPrint]);
  return (
    <PosModal
      rootId="order-slip-print-root"
      title={`Order ${orderNumber(order.number)}`}
      onClose={onClose}
      busy={busy}
      className="order-slip-dialog"
      footer={
        <div className="space-y-3">
          <ErrorBanner message={error} />
          {status && (
            <p role="status" className="text-xs text-slate-600">
              {status}
            </p>
          )}
          <p className="text-xs text-slate-500">
            Saved to Sales. Printing or reprinting never adds another sale.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            {onEdit && (
              <button className="md-btn md-btn-outline" disabled={busy} onClick={onEdit}>
                <Pencil size={16} />
                Edit sale
              </button>
            )}
            <button className="md-btn md-btn-outline" onClick={onClose} disabled={busy}>
              Back to POS
            </button>
            {settings.method !== 'system' && (
              <button className="md-btn md-btn-outline" disabled={busy} onClick={() => print(true)}>
                Device print dialog
              </button>
            )}
            <button className="md-btn md-btn-primary" disabled={busy} onClick={() => print()}>
              <Printer size={17} />
              {busy ? 'Sending…' : 'Print order slip'}
            </button>
          </div>
        </div>
      }
    >
      <style>{`@media print { @page { size: ${width}mm ${height}mm; margin: 0; } }`}</style>
      <div className="order-slip-preview bg-slate-100 p-5">
        <article ref={paper} className="order-slip-paper" style={{ width: `${width}mm` }}>
          <header className="text-center">
            <h1 className="text-base font-bold">Schyler’s Kitchen</h1>
            <p className="mt-2 uppercase tracking-widest">Order slip</p>
            <p className="my-2 text-2xl font-bold">{orderNumber(order.number)}</p>
            <p>{receiptTime(order.createdAt)}</p>
            {order.revision > 1 && <p className="mt-2">Corrected · Revision {order.revision}</p>}
            <p className="mt-2 font-bold">{order.type}</p>
          </header>
          {order.customer && (
            <p className="mt-3 break-words">
              For: <strong>{order.customer}</strong>
            </p>
          )}
          <p className="mt-1 break-words">Staff: {order.cashier}</p>
          <div className="my-3 border-t border-dashed border-black" />
          {order.items.map((item, index) => (
            <div key={index} className="mb-3">
              <p className="break-words font-bold">
                {item.quantity} × {item.name}
              </p>
              <div className="mt-1 flex justify-between gap-2">
                <span>@ {peso(item.unitPrice)}</span>
                <span>{peso(item.lineTotal)}</span>
              </div>
            </div>
          ))}
          <div className="my-3 border-t border-dashed border-black" />
          <div className="flex justify-between gap-2 text-sm font-bold">
            <span>TOTAL</span>
            <span>{peso(order.total)}</span>
          </div>
          <div className="mt-2 flex justify-between gap-2">
            <span>Cash received</span>
            <span>{peso(order.cashReceived)}</span>
          </div>
          <div className="mt-1 flex justify-between gap-2">
            <span>Change</span>
            <span>{peso(order.change)}</span>
          </div>
          {order.notes && (
            <div className="mt-4 border-t border-dashed border-black pt-3">
              <p className="font-bold">Order notes</p>
              <p className="mt-1 whitespace-pre-wrap break-words">{order.notes}</p>
            </div>
          )}
          <p className="mt-5 text-center">Thank you!</p>
        </article>
      </div>
    </PosModal>
  );
}
