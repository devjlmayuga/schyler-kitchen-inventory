import { escPosReceipt } from './receipt.js';

export const DEFAULT_PRINTER = {
  method: 'system',
  paperWidth: 58,
  autoPrint: true,
  cut: false,
  baudRate: 9600,
  service: '',
  characteristic: '',
};
let serialPort;
let bluetoothDevice;
let characteristic;
let connectedMethod = '';
let printing = false;
const listeners = new Set();
const publish = () => listeners.forEach((listener) => listener(printerStatus()));
export const printerStatus = () => ({
  method: connectedMethod,
  connected:
    connectedMethod === 'serial'
      ? !!serialPort?.writable
      : !!bluetoothDevice?.gatt?.connected && !!characteristic,
  name:
    connectedMethod === 'serial'
      ? 'Bluetooth / serial printer'
      : bluetoothDevice?.name || 'Bluetooth printer',
});
export function subscribePrinter(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function printerCapabilities() {
  return { serial: !!navigator.serial, bluetooth: !!navigator.bluetooth, secure: window.isSecureContext };
}
export function loadPrinterSettings() {
  try {
    return { ...DEFAULT_PRINTER, ...JSON.parse(localStorage.getItem('si_pos_printer') || '{}') };
  } catch {
    return { ...DEFAULT_PRINTER };
  }
}
export function savePrinterSettings(settings) {
  localStorage.setItem('si_pos_printer', JSON.stringify(settings));
}

function uuid(value) {
  const text = String(value || '')
    .trim()
    .toLowerCase();
  if (/^(?:0x)?[0-9a-f]{4}$/.test(text)) return `0000${text.replace('0x', '')}-0000-1000-8000-00805f9b34fb`;
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(text)) return text;
  throw new Error(
    'Enter the Bluetooth service and print characteristic UUIDs from your printer documentation.',
  );
}

export async function disconnectPrinter() {
  if (printing) throw new Error('Wait for the current slip to finish sending.');
  bluetoothDevice?.gatt?.disconnect();
  if (serialPort) await serialPort.close().catch(() => {});
  serialPort = undefined;
  bluetoothDevice = undefined;
  characteristic = undefined;
  connectedMethod = '';
  publish();
}

export async function connectPrinter(settings) {
  if (printing) throw new Error('Wait for the current slip to finish sending.');
  if (settings.method === 'system') return;
  if (printerStatus().connected) throw new Error('Disconnect the current printer before choosing another.');
  if (!window.isSecureContext) throw new Error('Open this site over HTTPS to connect a printer.');
  try {
    if (settings.method === 'serial') {
      if (!navigator.serial)
        throw new Error(
          'Direct serial printing is unavailable in this browser. Use the device print dialog.',
        );
      const port = await navigator.serial.requestPort();
      await port.open({ baudRate: Number(settings.baudRate) || 9600 });
      serialPort = port;
      connectedMethod = 'serial';
      port.addEventListener('disconnect', () => {
        if (serialPort === port) {
          serialPort = undefined;
          connectedMethod = '';
          publish();
        }
      });
    } else {
      if (!navigator.bluetooth)
        throw new Error(
          'Direct Bluetooth printing is unavailable in this browser. Use the device print dialog.',
        );
      const service = uuid(settings.service);
      const printCharacteristic = uuid(settings.characteristic);
      const device = await navigator.bluetooth.requestDevice({
        filters: [{ services: [service] }],
        optionalServices: [service],
      });
      bluetoothDevice = device;
      device.addEventListener('gattserverdisconnected', () => {
        if (bluetoothDevice === device) {
          characteristic = undefined;
          connectedMethod = '';
          publish();
        }
      });
      const server = await device.gatt.connect();
      const primaryService = await server.getPrimaryService(service);
      characteristic = await primaryService.getCharacteristic(printCharacteristic);
      if (!characteristic.properties.write && !characteristic.properties.writeWithoutResponse)
        throw new Error('The selected Bluetooth characteristic does not support printing.');
      connectedMethod = 'bluetooth';
    }
    publish();
  } catch (error) {
    bluetoothDevice?.gatt?.disconnect();
    characteristic = undefined;
    connectedMethod = '';
    publish();
    if (error.name === 'NotFoundError')
      throw new Error('No printer selected. Your settings and sales are unchanged.');
    throw error;
  }
}

function timeout(promise, ms = 15000) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Printer did not respond.')), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

export async function sendReceipt(order, settings) {
  if (printing) throw new Error('A slip is already being sent.');
  if (!printerStatus().connected || connectedMethod !== settings.method)
    throw new Error('Printer disconnected. Connect it in Printer setup, then reprint this saved order.');
  printing = true;
  const bytes = escPosReceipt(order, settings);
  let writer;
  let failed = false;
  try {
    if (connectedMethod === 'serial') {
      writer = serialPort.writable.getWriter();
      for (let i = 0; i < bytes.length; i += 256) await timeout(writer.write(bytes.slice(i, i + 256)));
    } else {
      for (let i = 0; i < bytes.length; i += 20) {
        const chunk = bytes.slice(i, i + 20);
        if (characteristic.properties.write) await timeout(characteristic.writeValueWithResponse(chunk));
        else await timeout(characteristic.writeValueWithoutResponse(chunk));
        await new Promise((resolve) => setTimeout(resolve, 15));
      }
    }
  } catch {
    failed = true;
    bluetoothDevice?.gatt?.disconnect();
    if (writer) await timeout(writer.abort(), 1000).catch(() => {});
    connectedMethod = '';
    publish();
    throw new Error(
      'Printing stopped. The sale is saved. Check for a partial slip before reconnecting and reprinting.',
    );
  } finally {
    writer?.releaseLock();
    printing = false;
    if (failed && serialPort) {
      await timeout(serialPort.close(), 1000).catch(() => {});
      serialPort = undefined;
    }
  }
}
