const PAGE_WIDTH = 595.28;
const PAGE_HEIGHT = 841.89;
const MARGIN = 42;

const ascii = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const pdfText = (value) => ascii(value).replace(/([\\()])/g, '\\$1');
const amount = (value) =>
  `PHP ${Number(value || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function payslipPdfFilename(payslip) {
  const staff =
    ascii(payslip.staff)
      .replace(/[^a-z0-9]+/gi, '_')
      .replace(/^_+|_+$/g, '') || 'Staff';
  return `${staff}_${payslip.start}_to_${payslip.end}.pdf`;
}

export function buildPayslipPdf(payslip) {
  const { staff, start, end, days, totals } = payslip;
  const commands = [];
  const y = (top) => PAGE_HEIGHT - top;
  const text = (value, x, top, size = 9, bold = false, color = '0.12 0.16 0.23') => {
    commands.push(
      `${color} rg BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x} ${y(top)} Td (${pdfText(value)}) Tj ET`,
    );
  };
  const right = (value, x, top, size = 9, bold = false) => {
    const estimate = ascii(value).length * size * (bold ? 0.54 : 0.49);
    text(value, x - estimate, top, size, bold);
  };
  const line = (x1, top1, x2, top2, width = 0.5, color = '0.82 0.85 0.89') => {
    commands.push(`${color} RG ${width} w ${x1} ${y(top1)} m ${x2} ${y(top2)} l S`);
  };
  const fill = (x, top, width, height, color) => {
    commands.push(`${color} rg ${x} ${y(top + height)} ${width} ${height} re f`);
  };

  fill(0, 0, PAGE_WIDTH, PAGE_HEIGHT, '1 1 1');
  fill(0, 0, PAGE_WIDTH, 9, '0.91 0.16 0.28');
  text("Schyler's Kitchen", MARGIN, 55, 18, true);
  text('STAFF PAYSLIP', MARGIN, 76, 9, true, '0.39 0.45 0.55');
  right(ascii(staff), PAGE_WIDTH - MARGIN, 55, 12, true);
  right(`${start} to ${end}`, PAGE_WIDTH - MARGIN, 75, 9, false);
  line(MARGIN, 94, PAGE_WIDTH - MARGIN, 94, 2, '0.91 0.16 0.28');

  const cards = [
    ['Days worked', totals.days],
    ['Quota days', totals.quotaDays],
    ['Overtime hours', totals.overtimeHours],
  ];
  cards.forEach(([label, value], index) => {
    const x = MARGIN + index * 171;
    fill(x, 112, 157, 55, '0.97 0.98 0.99');
    text(label, x + 12, 134, 8, false, '0.39 0.45 0.55');
    text(value, x + 12, 157, 16, true);
  });

  const columns = [MARGIN, 126, 184, 267, 355, 453, PAGE_WIDTH - MARGIN];
  const headers = ['Date', 'Duty', 'Base pay', 'Quota bonus', 'Overtime', 'Total'];
  fill(MARGIN, 190, PAGE_WIDTH - MARGIN * 2, 28, '0.95 0.96 0.98');
  headers.forEach((header, index) => text(header, columns[index] + 7, 208, 7.5, true, '0.29 0.35 0.44'));
  days.forEach((day, row) => {
    const top = 218 + row * 39;
    if (row % 2) fill(MARGIN, top, PAGE_WIDTH - MARGIN * 2, 39, '0.985 0.988 0.992');
    const values = [
      day.date,
      day.onDuty ? 'Yes' : '-',
      amount(day.base),
      day.quotaHit ? amount(day.bonus) : '-',
      day.overtimeHours ? `${amount(day.overtime)}` : '-',
      amount(day.total),
    ];
    values.forEach((value, index) =>
      text(value, columns[index] + 7, top + 23, index === 4 ? 7.2 : 7.8, index === 5),
    );
    line(MARGIN, top + 39, PAGE_WIDTH - MARGIN, top + 39);
  });

  const summaryTop = 522;
  text('PAY SUMMARY', 340, summaryTop, 9, true, '0.39 0.45 0.55');
  [
    ['Base pay', totals.base],
    ['Quota bonus', totals.bonus],
    ['Overtime pay', totals.overtime],
  ].forEach(([label, value], index) => {
    text(label, 340, summaryTop + 27 + index * 25, 9);
    right(amount(value), PAGE_WIDTH - MARGIN, summaryTop + 27 + index * 25, 9);
  });
  line(340, summaryTop + 91, PAGE_WIDTH - MARGIN, summaryTop + 91, 1.5, '0.12 0.16 0.23');
  text('Total earnings', 340, summaryTop + 116, 11, true);
  right(amount(totals.total), PAGE_WIDTH - MARGIN, summaryTop + 116, 11, true);

  text(
    'Quota bonuses apply on duty days when shop sales exceed the saved daily target.',
    MARGIN,
    674,
    8,
    false,
    '0.39 0.45 0.55',
  );
  text('Amounts shown are earnings before any deductions.', MARGIN, 688, 8, false, '0.39 0.45 0.55');
  line(MARGIN, 748, 235, 748, 0.7, '0.39 0.45 0.55');
  line(360, 748, PAGE_WIDTH - MARGIN, 748, 0.7, '0.39 0.45 0.55');
  text('Prepared by', MARGIN, 765, 8, false, '0.39 0.45 0.55');
  text('Received by / Date', 360, 765, 8, false, '0.39 0.45 0.55');
  right('Generated from Schyler Kitchen Inventory', PAGE_WIDTH - MARGIN, 810, 7, false, '0.55 0.60 0.67');

  const stream = `${commands.join('\n')}\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>',
    `<< /Length ${stream.length} >>\nstream\n${stream}endstream`,
  ];
  let output = '%PDF-1.4\n%PDFGEN\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets[index + 1] = output.length;
    output += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = output.length;
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  });
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

export function downloadPayslipPdf(payslip) {
  const url = URL.createObjectURL(new Blob([buildPayslipPdf(payslip)], { type: 'application/pdf' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = payslipPdfFilename(payslip);
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
