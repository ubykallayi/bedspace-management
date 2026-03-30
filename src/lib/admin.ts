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

export const getMonthlyPaymentStatus = (due: number, paid: number): MonthlyPaymentStatus => {
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
