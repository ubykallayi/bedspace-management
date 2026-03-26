import { format } from 'date-fns';
import { formatCurrency } from './admin';

export type PaymentReceiptData = {
  receiptNumber: string;
  siteName: string;
  companyName: string;
  supportEmail: string;
  supportPhone: string;
  tenantName: string;
  tenantEmail: string;
  tenantPhone: string;
  roomName: string;
  bedNumber: string;
  billingMonth: string;
  paymentDate: string;
  amount: number;
  dueAmount: number;
  paidAmount: number;
  remainingAmount: number;
  paymentStatus: string;
};

const escapeHtml = (value: string) => value
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

export const buildPaymentReceiptHtml = (receipt: PaymentReceiptData) => {
  const summaryRows = [
    ['Tenant', receipt.tenantName],
    ['Email', receipt.tenantEmail || 'Not provided'],
    ['Mobile', receipt.tenantPhone || 'Not provided'],
    ['Room', receipt.roomName],
    ['Bed', receipt.bedNumber],
    ['Rent Month', format(new Date(receipt.billingMonth), 'MMMM yyyy')],
    ['Payment Date', format(new Date(receipt.paymentDate), 'dd MMM yyyy')],
    ['Status', receipt.paymentStatus],
  ];

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(receipt.siteName)} Receipt</title>
  <style>
    :root {
      color-scheme: light;
      --accent: #5b47d6;
      --accent-soft: #ece8ff;
      --accent-deep: #2a215c;
      --success-soft: #e8fbf2;
      --success: #14804a;
      --warning-soft: #fff4df;
      --warning: #b76a00;
      --ink: #152033;
      --muted: #667085;
      --line: #dbe3f0;
      --surface: #f8faff;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    body {
      margin: 0;
      font-family: Arial, sans-serif;
      color: var(--ink);
      background:
        radial-gradient(circle at top left, rgba(91, 71, 214, 0.12), transparent 28%),
        linear-gradient(180deg, #f4f7fc 0%, #edf2f9 100%);
      padding: 24px;
    }
    .receipt {
      max-width: 860px;
      margin: 0 auto;
      background: #fff;
      border-radius: 18px;
      overflow: hidden;
      box-shadow: 0 18px 50px rgba(17, 24, 39, 0.12);
      border: 1px solid #e8eef8;
    }
    .header {
      background:
        radial-gradient(circle at top right, rgba(255,255,255,0.16), transparent 30%),
        linear-gradient(135deg, #1f2a44, #5b47d6);
      color: #fff;
      padding: 28px 32px;
      display: flex;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
    }
    .title {
      font-size: 30px;
      font-weight: 700;
      margin: 0 0 6px;
    }
    .subtitle {
      margin: 0;
      opacity: 0.88;
      font-size: 14px;
    }
    .meta {
      text-align: right;
      min-width: 220px;
    }
    .meta p {
      margin: 0 0 8px;
      font-size: 14px;
    }
    .section {
      padding: 28px 32px;
      border-top: 1px solid var(--line);
    }
    .detail-shell {
      display: grid;
      grid-template-columns: 1.15fr 0.85fr;
      gap: 18px;
    }
    .detail-card {
      border: 1px solid var(--line);
      border-radius: 16px;
      background: #fff;
      padding: 20px;
    }
    .detail-card.soft {
      background: linear-gradient(135deg, #faf8ff, #ffffff);
      border-color: #ddd5ff;
    }
    .detail-title {
      margin: 0 0 14px;
      font-size: 16px;
      font-weight: 700;
      color: var(--accent-deep);
    }
    .detail-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px 18px;
    }
    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: 14px 22px;
    }
    .label {
      font-size: 12px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      color: var(--muted);
      margin-bottom: 6px;
    }
    .value {
      font-size: 15px;
      font-weight: 600;
    }
    .status-pill {
      display: inline-flex;
      align-items: center;
      padding: 6px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 700;
      background: var(--accent-soft);
      color: var(--accent-deep);
    }
    .summary {
      display: grid;
      grid-template-columns: 2fr 1fr;
      gap: 20px;
    }
    .table {
      width: 100%;
      border-collapse: collapse;
    }
    .table td {
      padding: 12px 0;
      border-bottom: 1px solid var(--line);
      vertical-align: top;
    }
    .table td:last-child {
      text-align: right;
      font-weight: 700;
    }
    .totals {
      background: var(--surface);
      border: 1px solid var(--line);
      border-radius: 16px;
      padding: 18px;
      align-self: start;
    }
    .totals-row {
      display: flex;
      justify-content: space-between;
      gap: 12px;
      padding: 10px 0;
      border-bottom: 1px solid var(--line);
      font-size: 14px;
    }
    .totals-row:last-child {
      border-bottom: none;
    }
    .totals-row strong {
      font-size: 18px;
      color: var(--accent);
    }
    .footer {
      padding: 0 32px 28px;
      color: var(--muted);
      font-size: 13px;
    }
    .print-note {
      max-width: 860px;
      margin: 0 auto 12px;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid #d6dcef;
      background: rgba(255,255,255,0.92);
      color: var(--muted);
      font-size: 13px;
    }
    .actions {
      max-width: 860px;
      margin: 0 auto 16px;
      display: flex;
      gap: 12px;
      justify-content: flex-end;
      flex-wrap: wrap;
    }
    .actions button {
      border: none;
      border-radius: 999px;
      padding: 12px 18px;
      font-weight: 700;
      cursor: pointer;
      color: #fff;
      background: var(--accent);
    }
    .actions button.secondary {
      background: #1f2a44;
    }
    @media print {
      @page {
        size: A4;
        margin: 12mm;
      }
      body { background: #fff !important; padding: 0; }
      .actions { display: none; }
      .print-note { display: none; }
      .receipt { box-shadow: none; border: none; }
    }
    @media (max-width: 720px) {
      body { padding: 12px; }
      .section, .header { padding: 20px; }
      .detail-shell,
      .detail-grid { grid-template-columns: 1fr; }
      .summary { grid-template-columns: 1fr; }
      .meta { text-align: left; }
    }
  </style>
</head>
<body>
  <div class="actions">
    <button onclick="window.print()">Save / Print PDF</button>
    <button class="secondary" onclick="window.close()">Close</button>
  </div>
  <div class="print-note">
    For the best PDF result, enable your browser's <strong>Background graphics</strong> option in the print dialog if colors do not appear.
  </div>
  <div class="receipt">
    <div class="header">
      <div>
        <h1 class="title">${escapeHtml(receipt.siteName)}</h1>
        <p class="subtitle">${escapeHtml(receipt.companyName || receipt.siteName)} Payment Receipt</p>
      </div>
      <div class="meta">
        <p><strong>Receipt #</strong> ${escapeHtml(receipt.receiptNumber)}</p>
        <p><strong>Issued</strong> ${escapeHtml(format(new Date(receipt.paymentDate), 'dd MMM yyyy'))}</p>
        ${receipt.supportEmail ? `<p>${escapeHtml(receipt.supportEmail)}</p>` : ''}
        ${receipt.supportPhone ? `<p>${escapeHtml(receipt.supportPhone)}</p>` : ''}
      </div>
    </div>

    <div class="section">
      <div class="detail-shell">
        <div class="detail-card soft">
          <h2 class="detail-title">Tenant Information</h2>
          <div class="detail-grid">
            ${summaryRows.slice(0, 5).map(([label, value]) => `
              <div>
                <div class="label">${escapeHtml(label)}</div>
                <div class="value">${escapeHtml(value)}</div>
              </div>
            `).join('')}
          </div>
        </div>
        <div class="detail-card">
          <h2 class="detail-title">Receipt Details</h2>
          <div class="grid">
            ${summaryRows.slice(5).map(([label, value]) => `
              <div>
                <div class="label">${escapeHtml(label)}</div>
                <div class="value">${label === 'Status' ? `<span class="status-pill">${escapeHtml(value)}</span>` : escapeHtml(value)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="summary">
        <table class="table">
          <tbody>
            <tr><td>Monthly Rent Due</td><td>${escapeHtml(formatCurrency(receipt.dueAmount))}</td></tr>
            <tr><td>Payment Received</td><td>${escapeHtml(formatCurrency(receipt.amount))}</td></tr>
            <tr><td>Total Paid For Month</td><td>${escapeHtml(formatCurrency(receipt.paidAmount))}</td></tr>
            <tr><td>Remaining Balance</td><td>${escapeHtml(formatCurrency(receipt.remainingAmount))}</td></tr>
          </tbody>
        </table>
        <div class="totals">
          <div class="label">Receipt Summary</div>
          <div class="totals-row"><span>Amount Received</span><strong>${escapeHtml(formatCurrency(receipt.amount))}</strong></div>
          <div class="totals-row"><span>Current Balance</span><span>${escapeHtml(formatCurrency(receipt.remainingAmount))}</span></div>
          <div class="totals-row"><span>Status</span><span>${escapeHtml(receipt.paymentStatus)}</span></div>
        </div>
      </div>
    </div>

    <div class="footer">
      This receipt was generated by ${escapeHtml(receipt.siteName)}. Please keep it for your records.
    </div>
  </div>
</body>
</html>`;
};

export const openPaymentReceipt = (
  receipt: PaymentReceiptData,
  targetWindow?: Window | null,
) => {
  const receiptWindow = targetWindow ?? window.open('about:blank', '_blank');
  if (!receiptWindow) return false;

  receiptWindow.opener = null;
  receiptWindow.document.open();
  receiptWindow.document.write(buildPaymentReceiptHtml(receipt));
  receiptWindow.document.close();
  return true;
};

export const getPaymentReceiptWhatsappMessage = (receipt: PaymentReceiptData) => {
  return [
    `Payment receipt from ${receipt.siteName}`,
    `Tenant: ${receipt.tenantName}`,
    `Room: ${receipt.roomName} | Bed: ${receipt.bedNumber}`,
    `Rent Month: ${format(new Date(receipt.billingMonth), 'MMMM yyyy')}`,
    `Amount Received: ${formatCurrency(receipt.amount)}`,
    `Remaining Balance: ${formatCurrency(receipt.remainingAmount)}`,
    'Your PDF receipt has been prepared by the admin.',
  ].join('\n');
};

export const getWhatsappShareLink = (receipt: PaymentReceiptData) => {
  const normalizedPhone = receipt.tenantPhone.replace(/[^\d]/g, '');
  const message = encodeURIComponent(getPaymentReceiptWhatsappMessage(receipt));
  return normalizedPhone.length > 0
    ? `https://wa.me/${normalizedPhone}?text=${message}`
    : `https://wa.me/?text=${message}`;
};
