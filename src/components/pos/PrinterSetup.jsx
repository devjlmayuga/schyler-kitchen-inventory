'use client';
import { useState } from 'react';
import { Bluetooth, Printer } from 'lucide-react';
import PosModal from './PosModal.jsx';
import ErrorBanner from '../ErrorBanner.jsx';
import {
  connectPrinter,
  disconnectPrinter,
  printerCapabilities,
  printerStatus,
  savePrinterSettings,
} from '../../lib/printer.js';

export default function PrinterSetup({ settings, onSave, onClose }) {
  const [draft, setDraft] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [status, setStatus] = useState(printerStatus());
  const capabilities = printerCapabilities();
  const update = (key, value) => setDraft((prev) => ({ ...prev, [key]: value }));
  async function connect() {
    setBusy(true);
    setError('');
    try {
      await connectPrinter(draft);
      setStatus(printerStatus());
    } catch (reason) {
      setError(reason.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <PosModal
      title="Printer setup"
      busy={busy}
      onClose={onClose}
      footer={
        <div className="flex justify-end">
          <button
            className="md-btn md-btn-primary"
            disabled={busy}
            onClick={() => {
              try {
                savePrinterSettings(draft);
                onSave(draft);
                onClose();
              } catch {
                setError('Printer settings could not be stored on this device.');
              }
            }}
          >
            Save printer settings
          </button>
        </div>
      }
    >
      <fieldset disabled={busy} className="min-w-0 space-y-5 p-5">
        <ErrorBanner message={error} />
        <label className="md-field">
          <span className="md-label">Print method</span>
          <select
            aria-label="Print method"
            className="md-select"
            value={draft.method}
            onChange={(event) => update('method', event.target.value)}
          >
            <option value="system">Device print dialog · all platforms</option>
            <option value="serial" disabled={!capabilities.serial}>
              Bluetooth Classic / USB serial · compatible desktop browsers
            </option>
            <option value="bluetooth" disabled={!capabilities.bluetooth}>
              Bluetooth Low Energy · compatible browsers
            </option>
          </select>
        </label>
        <p className="text-sm leading-relaxed text-slate-500">
          {draft.method === 'system'
            ? 'Choose your connected printer in the device’s print dialog. If it is missing, install the manufacturer’s print service or driver. Pairing alone may not make a Bluetooth printer available for web printing.'
            : 'Direct printing requires an ESC/POS-compatible receipt printer. Pair Bluetooth Classic printers in your device settings first.'}
        </p>
        <div className="grid grid-cols-2 gap-4">
          <label className="md-field">
            <span className="md-label">Paper width</span>
            <select
              aria-label="Paper width"
              className="md-select"
              value={draft.paperWidth}
              onChange={(event) => update('paperWidth', Number(event.target.value))}
            >
              <option value={58}>58 mm</option>
              <option value={80}>80 mm</option>
            </select>
          </label>
          {draft.method === 'serial' && (
            <label className="md-field">
              <span className="md-label">Printer baud rate</span>
              <select
                aria-label="Printer baud rate"
                className="md-select"
                value={draft.baudRate}
                onChange={(event) => update('baudRate', Number(event.target.value))}
              >
                {[9600, 19200, 38400, 57600, 115200].map((rate) => (
                  <option key={rate}>{rate}</option>
                ))}
              </select>
            </label>
          )}
        </div>
        {draft.method === 'bluetooth' && (
          <div className="space-y-3 rounded-xl bg-slate-50 p-4">
            <p className="text-xs leading-relaxed text-slate-500">
              Use the service and writable characteristic UUIDs documented by your printer manufacturer. This
              connection supports BLE printers, not Bluetooth Classic-only models.
            </p>
            <label className="md-field">
              <span className="md-label">Bluetooth service UUID</span>
              <input
                className="md-input"
                value={draft.service}
                onChange={(event) => update('service', event.target.value)}
                placeholder="From printer documentation"
              />
            </label>
            <label className="md-field">
              <span className="md-label">Print characteristic UUID</span>
              <input
                className="md-input"
                value={draft.characteristic}
                onChange={(event) => update('characteristic', event.target.value)}
                placeholder="From printer documentation"
              />
            </label>
          </div>
        )}
        <label className="flex items-center gap-3 text-sm">
          <input
            type="checkbox"
            className="h-4 w-4 accent-[var(--p-3)]"
            checked={draft.autoPrint}
            onChange={(event) => update('autoPrint', event.target.checked)}
          />
          Print after completing each sale
        </label>
        {draft.method !== 'system' && (
          <>
            <label className="flex items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-4 w-4 accent-[var(--p-3)]"
                checked={draft.cut}
                onChange={(event) => update('cut', event.target.checked)}
              />
              Cut paper after printing (printers with a cutter)
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <button className="md-btn md-btn-outline" onClick={connect} disabled={status.connected}>
                <Bluetooth size={17} />
                {busy ? 'Connecting…' : 'Connect printer'}
              </button>
              {status.connected && (
                <button
                  className="md-btn md-btn-ghost"
                  onClick={async () => {
                    setBusy(true);
                    try {
                      await disconnectPrinter();
                      setStatus(printerStatus());
                    } catch (reason) {
                      setError(reason.message);
                    } finally {
                      setBusy(false);
                    }
                  }}
                >
                  Disconnect
                </button>
              )}
              <span role="status" className="text-xs text-slate-500">
                {status.connected ? `Connected: ${status.name}` : 'Not connected'}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Direct slips use plain text. Use the device print dialog for names with non-Latin characters.
            </p>
          </>
        )}
        {draft.method === 'system' && (
          <div className="flex items-center gap-2 rounded-xl bg-[var(--brand-soft)] p-4 text-xs text-[var(--p-4)]">
            <Printer size={17} />
            58 / 80 mm slips are ready to print or save as PDF.
          </div>
        )}
      </fieldset>
    </PosModal>
  );
}
