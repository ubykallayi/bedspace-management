import { format } from 'date-fns';
import { supabase } from './supabase';

export type BookingLifecycleStatus = 'active' | 'upcoming' | 'expired' | 'inactive';
export type MonthlyPaymentStatus = 'paid' | 'partial' | 'unpaid';

let formattingSettings = {
  currencyCode: 'AED',
  currencySymbol: 'AED',
};

export const setFormattingSettings = ({
  currencyCode,
  currencySymbol,
}: {
  currencyCode?: string;
  currencySymbol?: string;
}) => {
  formattingSettings = {
    currencyCode: currencyCode?.trim() || formattingSettings.currencyCode,
    currencySymbol: currencySymbol?.trim() || formattingSettings.currencySymbol,
  };
};

export const getMonthStartKey = (value: Date | string) => {
  const date = typeof value === 'string' ? new Date(value) : value;
  return format(new Date(date.getFullYear(), date.getMonth(), 1), 'yyyy-MM-dd');
};

export const getMonthInputValue = (value: Date | string) => getMonthStartKey(value).slice(0, 7);

export const formatCurrency = (value: number) => `${formattingSettings.currencySymbol} ${value.toFixed(2)}`;

const roundCurrencyAmount = (value: number) => Math.round(value * 100) / 100;

export const calculateProratedRent = (rentAmount: number, startDate: Date | string) => {
  if (!Number.isFinite(rentAmount) || rentAmount <= 0) return 0;

  const normalizedStartDate = typeof startDate === 'string' ? new Date(startDate) : startDate;
  if (Number.isNaN(normalizedStartDate.getTime())) return roundCurrencyAmount(rentAmount);

  const daysInMonth = new Date(
    normalizedStartDate.getFullYear(),
    normalizedStartDate.getMonth() + 1,
    0,
  ).getDate();
  const occupiedDays = daysInMonth - normalizedStartDate.getDate() + 1;

  return roundCurrencyAmount((rentAmount / daysInMonth) * occupiedDays);
};

export const getRentDueForBillingMonth = ({
  rentAmount,
  proratedRent,
  startDate,
  billingMonth,
}: {
  rentAmount: number;
  proratedRent?: number | null;
  startDate: string;
  billingMonth: Date | string;
}) => {
  const normalizedRent = Number(rentAmount);
  if (!Number.isFinite(normalizedRent) || normalizedRent <= 0) return 0;

  const startMonthKey = getMonthStartKey(startDate);
  const billingMonthKey = getMonthStartKey(billingMonth);

  if (startMonthKey !== billingMonthKey) {
    return roundCurrencyAmount(normalizedRent);
  }

  if (proratedRent != null && Number.isFinite(Number(proratedRent))) {
    return roundCurrencyAmount(Number(proratedRent));
  }

  return calculateProratedRent(normalizedRent, startDate);
};

export const calculatePreviousBalance = (
  tenant: { rent_amount: number | string; prorated_rent?: number | string | null; start_date: string; id: string },
  targetBillingMonth: string,
  allPayments: { tenant_id: string; billing_month: string; amount: number | string; status: string; is_balance_waived?: boolean }[],
  allCharges: { tenant_id: string; billing_month: string; amount: number | string }[]
): number => {
  let totalPreviousBalance = 0;

  const getMonthIndex = (monthKey: string) => {
    const [year, month] = monthKey.split('-').map(Number);
    return year * 12 + (month - 1);
  };

  const getMonthKeyFromIndex = (monthIndex: number) => {
    const year = Math.floor(monthIndex / 12);
    const month = (monthIndex % 12) + 1;
    return `${year}-${String(month).padStart(2, '0')}-01`;
  };

  const startMonthIndex = getMonthIndex(getMonthStartKey(tenant.start_date));
  const targetMonthIndex = getMonthIndex(getMonthStartKey(targetBillingMonth));

  for (let currentMonthIndex = startMonthIndex; currentMonthIndex < targetMonthIndex; currentMonthIndex += 1) {
    const currentMonthKey = getMonthKeyFromIndex(currentMonthIndex);
    
    const baseDue = getRentDueForBillingMonth({
      rentAmount: Number(tenant.rent_amount),
      proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
      startDate: tenant.start_date,
      billingMonth: currentMonthKey,
    });
    
    const extraCharges = allCharges
      .filter((c) => c.tenant_id === tenant.id && c.billing_month === currentMonthKey)
      .reduce((sum, c) => sum + Number(c.amount), 0);
      
    const due = baseDue + extraCharges;
    
    const monthPayments = allPayments.filter((p) => p.tenant_id === tenant.id && p.billing_month === currentMonthKey && p.status === 'paid');
    const paid = monthPayments.reduce((sum, p) => sum + Number(p.amount), 0);
    const isWaived = monthPayments.some((p) => p.is_balance_waived);
    
    if (!isWaived) {
      const remaining = Math.max(due - paid, 0); // Ignore overpayments
      totalPreviousBalance += remaining;
    }
  }

  return Math.round(totalPreviousBalance * 100) / 100;
};

export const calculateTenantBalanceForMonth = (
  tenant: { rent_amount: number | string; prorated_rent?: number | string | null; start_date: string; id: string },
  targetBillingMonth: string,
  allPayments: { tenant_id: string; billing_month: string; amount: number | string; status: string; is_balance_waived?: boolean }[],
  allCharges: { tenant_id: string; billing_month: string; amount: number | string }[],
) => {
  const baseDue = getRentDueForBillingMonth({
    rentAmount: Number(tenant.rent_amount),
    proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
    startDate: tenant.start_date,
    billingMonth: targetBillingMonth,
  });

  const extraCharges = allCharges
    .filter((charge) => charge.tenant_id === tenant.id && charge.billing_month === targetBillingMonth)
    .reduce((sum, charge) => sum + Number(charge.amount), 0);

  const previousBalance = calculatePreviousBalance(tenant, targetBillingMonth, allPayments, allCharges);
  const monthPayments = allPayments.filter((payment) => (
    payment.tenant_id === tenant.id &&
    payment.billing_month === targetBillingMonth &&
    payment.status === 'paid'
  ));
  const paidAmount = monthPayments.reduce((sum, payment) => sum + Number(payment.amount), 0);
  const isBalanceWaived = monthPayments.some((payment) => payment.is_balance_waived);
  const dueAmount = Math.round((baseDue + extraCharges + previousBalance) * 100) / 100;
  const remainingAmount = isBalanceWaived ? 0 : Math.max(dueAmount - paidAmount, 0);

  return {
    baseDue,
    extraCharges,
    previousBalance,
    dueAmount,
    paidAmount,
    remainingAmount,
    isBalanceWaived,
    status: getMonthlyPaymentStatus(dueAmount, paidAmount, isBalanceWaived),
  };
};

export const isMissingColumnError = (error: unknown) => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42703';
};

export const isMissingTableError = (error: unknown) => {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === '42P01';
};

export const getBookingLifecycleStatus = (
  startDate: string,
  endDate: string | null,
  isActive = true,
  today = new Date(),
): BookingLifecycleStatus => {
  if (!isActive) return 'inactive';

  const todayKey = format(today, 'yyyy-MM-dd');
  if (startDate > todayKey) return 'upcoming';
  if (endDate && endDate < todayKey) return 'expired';
  return 'active';
};

export const getBookingStatusBadgeClass = (status: BookingLifecycleStatus) => {
  if (status === 'active') return 'badge-success';
  if (status === 'upcoming') return 'badge-warning';
  return 'badge-danger';
};

export const getBookingStatusLabel = (status: BookingLifecycleStatus) => {
  if (status === 'active') return 'Active';
  if (status === 'upcoming') return 'Upcoming';
  if (status === 'expired') return 'Expired';
  return 'Inactive';
};

export const getMonthlyPaymentStatus = (due: number, paid: number, isBalanceWaived?: boolean): MonthlyPaymentStatus => {
  if (isBalanceWaived) return 'paid';
  if (paid >= due && due > 0) return 'paid';
  if (paid > 0) return 'partial';
  return 'unpaid';
};

export const getPaymentStatusBadgeClass = (status: MonthlyPaymentStatus) => {
  if (status === 'paid') return 'badge-success';
  if (status === 'partial') return 'badge-warning';
  return 'badge-danger';
};

export const getPaymentStatusLabel = (status: MonthlyPaymentStatus) => {
  if (status === 'paid') return 'Paid';
  if (status === 'partial') return 'Partial';
  return 'Unpaid';
};

const escapeCsvValue = (value: string | number | null | undefined) => {
  if (value === null || value === undefined) return '';
  const normalized = String(value);
  if (normalized.includes(',') || normalized.includes('"') || normalized.includes('\n')) {
    return `"${normalized.replace(/"/g, '""')}"`;
  }
  return normalized;
};

export const downloadCsv = (
  filename: string,
  headers: string[],
  rows: Array<Array<string | number | null | undefined>>,
) => {
  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => escapeCsvValue(cell)).join(','))
    .join('\n');

  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};

export const writeActivityLog = async ({
  action,
  entityType,
  entityId,
  description,
  actorId,
}: {
  action: string;
  entityType: string;
  entityId: string;
  description: string;
  actorId?: string | null;
}) => {
  const { error } = await supabase
    .from('activity_logs')
    .insert([{
      action,
      entity_type: entityType,
      entity_id: entityId,
      description,
      created_by: actorId ?? null,
    }]);

  if (error && !isMissingColumnError(error) && error.code !== '42P01') {
    console.error('Activity log error:', error);
  }
};
