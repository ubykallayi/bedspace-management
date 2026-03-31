import { addDays, format, startOfMonth, lastDayOfMonth, differenceInCalendarDays } from 'date-fns';
import { getCachedAdminData, setCachedAdminData } from './adminDataCache';
import { getRentDueForBillingMonth, getMonthlyPaymentStatus, isMissingColumnError } from './admin';
import { supabase } from './supabase';

type RoomRecord = { id: string; name: string };
type BedRecord = { id: string; bed_number: string; room_id: string; property_id?: string };
type TenantRecord = {
  id: string;
  name: string;
  email?: string;
  phone?: string;
  bed_id: string;
  rent_amount: number | string;
  prorated_rent?: number | string | null;
  start_date: string;
  end_date: string | null;
  is_active?: boolean;
  property_id?: string;
};
type PaymentRecord = {
  tenant_id: string;
  amount: number | string;
  status: 'paid' | 'pending';
  billing_month: string;
};

export type AdminAlertRow = {
  id: string;
  name: string;
  roomName?: string;
  bedNumber?: string;
  remaining?: number;
  daysToExpiry?: number;
  paymentStatus?: 'paid' | 'partial' | 'unpaid';
};

export type AdminAlertsData = {
  unpaidTenants: AdminAlertRow[];
  expiringTenants: AdminAlertRow[];
};

const ADMIN_ALERTS_CACHE_KEY = 'admin-alerts';
const ENHANCED_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, prorated_rent, start_date, end_date, is_active';
const LEGACY_ENHANCED_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, start_date, end_date, is_active';
const BASE_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, prorated_rent, start_date, end_date';
const LEGACY_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, start_date, end_date';

export const getCachedAdminAlerts = (propertyId?: string | null) => (
  getCachedAdminData<AdminAlertsData>(`${ADMIN_ALERTS_CACHE_KEY}:${propertyId ?? 'none'}`)
);

export const fetchAdminAlerts = async (propertyId?: string | null): Promise<AdminAlertsData> => {
  if (!propertyId) {
    return { unpaidTenants: [], expiringTenants: [] };
  }

  const cacheKey = `${ADMIN_ALERTS_CACHE_KEY}:${propertyId}`;
  const cached = getCachedAdminAlerts(propertyId);
  if (cached) return cached;

  let tenants: TenantRecord[] = [];
  const tenantQueries = [
    ENHANCED_TENANT_SELECT,
    LEGACY_ENHANCED_TENANT_SELECT,
    BASE_TENANT_SELECT,
    LEGACY_TENANT_SELECT,
  ] as const;

  for (const select of tenantQueries) {
    const tenantResult = await supabase.from('tenants').select(`${select}, property_id`).eq('property_id', propertyId);
    if (!tenantResult.error) {
      tenants = (tenantResult.data ?? []) as unknown as TenantRecord[];
      break;
    }
    if (!isMissingColumnError(tenantResult.error)) {
      throw tenantResult.error;
    }
  }

  const [
    { data: bedsData, error: bedsError },
    { data: roomsData, error: roomsError },
  ] = await Promise.all([
    supabase.from('beds').select('id, bed_number, room_id, property_id').eq('property_id', propertyId),
    supabase.from('rooms').select('id, name').eq('property_id', propertyId),
  ]);

  if (bedsError) throw bedsError;
  if (roomsError) throw roomsError;

  const beds = (bedsData ?? []) as BedRecord[];
  const rooms = (roomsData ?? []) as RoomRecord[];
  const tenantIds = tenants.map((tenant) => tenant.id);
  const paymentsResult = tenantIds.length > 0
    ? await supabase.from('payments').select('tenant_id, amount, status, billing_month').in('tenant_id', tenantIds)
    : { data: [] as PaymentRecord[], error: null };

  if (paymentsResult.error) throw paymentsResult.error;

  const payments = (paymentsResult.data ?? []) as PaymentRecord[];
  const today = new Date();
  const todayKey = format(today, 'yyyy-MM-dd');
  const expiryCutoffKey = format(addDays(today, 7), 'yyyy-MM-dd');
  const monthStart = startOfMonth(today);
  const monthEnd = lastDayOfMonth(today);
  const billingMonth = format(monthStart, 'yyyy-MM-dd');

  const paidTotals = new Map<string, number>();
  payments
    .filter((payment) => payment.status === 'paid' && payment.billing_month === billingMonth)
    .forEach((payment) => {
      paidTotals.set(payment.tenant_id, (paidTotals.get(payment.tenant_id) ?? 0) + Number(payment.amount));
    });

  const activeMonthTenants = tenants.filter((tenant) => (
    tenant.is_active !== false &&
    tenant.start_date <= format(monthEnd, 'yyyy-MM-dd') &&
    (!tenant.end_date || tenant.end_date >= format(monthStart, 'yyyy-MM-dd'))
  ));

  const toAlertRow = (tenant: TenantRecord): AdminAlertRow => {
    const bed = beds.find((item) => item.id === tenant.bed_id);
    const room = bed ? rooms.find((item) => item.id === bed.room_id) : null;

    return {
      id: tenant.id,
      name: tenant.name,
      roomName: room?.name,
      bedNumber: bed?.bed_number,
    };
  };

  const unpaidTenants = activeMonthTenants.map((tenant) => {
    const due = getRentDueForBillingMonth({
      rentAmount: Number(tenant.rent_amount),
      proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
      startDate: tenant.start_date,
      billingMonth,
    });
    const paid = paidTotals.get(tenant.id) ?? 0;
    const remaining = Math.max(due - paid, 0);
    return {
      ...toAlertRow(tenant),
      remaining,
      paymentStatus: getMonthlyPaymentStatus(due, paid),
    };
  }).filter((tenant) => (tenant.remaining ?? 0) > 0);

  const expiringTenants = tenants
    .filter((tenant) => (
      tenant.is_active !== false &&
      tenant.end_date &&
      tenant.end_date >= todayKey &&
      tenant.end_date <= expiryCutoffKey
    ))
    .map((tenant) => ({
      ...toAlertRow(tenant),
      daysToExpiry: differenceInCalendarDays(new Date(tenant.end_date as string), today),
    }));

  const alerts = { unpaidTenants, expiringTenants };
  setCachedAdminData(cacheKey, alerts);
  return alerts;
};
