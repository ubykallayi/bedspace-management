import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, lastDayOfMonth, startOfMonth } from 'date-fns';
import { CheckCircle2, Download, MessageCircle, Pencil, PlusCircle, ReceiptText, Search, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { MobileActionMenu } from '../../components/ui/MobileActionMenu';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  calculateTenantBalanceForMonth,
  downloadCsv,
  formatCurrency,
  getMonthInputValue,
  getMonthStartKey,
  getMonthlyPaymentStatus,
  getPaymentStatusBadgeClass,
  getPaymentStatusLabel,
  isMissingColumnError,
  writeActivityLog,
} from '../../lib/admin';
import {
  getWhatsappShareLink,
  openPaymentReceipt,
  PaymentReceiptData,
} from '../../lib/receipts';
import { getCachedAdminData, invalidateAdminDataCache, setCachedAdminData } from '../../lib/adminDataCache';
import { AdminAlertsData, fetchAdminAlerts, getCachedAdminAlerts } from '../../lib/adminAlerts';
import { supabase, withSupabaseTimeout } from '../../lib/supabase';

type RoomRecord = {
  id: string;
  name: string;
};

type BedRecord = {
  id: string;
  bed_number: string;
  room_id: string;
  property_id?: string;
};

type TenantSummary = {
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
  photo_url?: string | null;
  room?: RoomRecord | null;
  bed?: BedRecord | null;
};

type PaymentRecord = {
  id: string;
  tenant_id: string;
  amount: number | string;
  payment_date: string;
  billing_month: string;
  status: 'paid' | 'pending';
  is_balance_waived?: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
  tenant?: TenantSummary | null;
  cycleDue?: number;
  cyclePaid?: number;
  cycleStatus?: 'paid' | 'partial' | 'unpaid';
};

type ChargeRecord = {
  id?: string;
  tenant_id: string;
  billing_month: string;
  amount: number | string;
  expense_id?: string | null;
  expenses?: {
    expense_date?: string | null;
    category?: string | null;
    description?: string | null;
  } | Array<{
    expense_date?: string | null;
    category?: string | null;
    description?: string | null;
  }> | null;
};

const getChargeDescription = (charge: ChargeRecord) => (
  Array.isArray(charge.expenses)
    ? charge.expenses[0]?.description
    : charge.expenses?.description
);

const getChargeCategory = (charge: ChargeRecord) => (
  Array.isArray(charge.expenses)
    ? charge.expenses[0]?.category
    : charge.expenses?.category
);

const getChargeExpenseDate = (charge: ChargeRecord) => (
  Array.isArray(charge.expenses)
    ? charge.expenses[0]?.expense_date
    : charge.expenses?.expense_date
);

const getCurrentBillingMonth = () => getMonthStartKey(new Date());

const BASE_PAYMENT_SELECT = 'id, tenant_id, amount, payment_date, billing_month, status, is_balance_waived';
const ENHANCED_PAYMENT_SELECT = `${BASE_PAYMENT_SELECT}, updated_at, updated_by`;
const ENHANCED_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, prorated_rent, start_date, end_date, is_active';
const BASE_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, prorated_rent, start_date, end_date';
const LEGACY_ENHANCED_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, start_date, end_date, is_active';
const LEGACY_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, start_date, end_date';
const PAYMENTS_CACHE_KEY = 'payments-page';

export const Payments = () => {
  const { settings } = useAppSettings();
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId, isLoading: propertiesLoading, error: propertiesError } = useAdminProperty();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [showChargeForm, setShowChargeForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [chargeFormError, setChargeFormError] = useState('');
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editingManualChargeId, setEditingManualChargeId] = useState<string | null>(null);
  const [paymentSchemaSupportsAudit, setPaymentSchemaSupportsAudit] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState(getMonthInputValue(new Date()));
  const [cycleStatusFilter, setCycleStatusFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [alerts, setAlerts] = useState<AdminAlertsData>({ unpaidTenants: [], expiringTenants: [] });
  const [pendingDeletePaymentId, setPendingDeletePaymentId] = useState<string | null>(null);
  const [pendingDeleteManualChargeId, setPendingDeleteManualChargeId] = useState<string | null>(null);
  const formCardRef = useRef<HTMLDivElement | null>(null);
  const chargeFormCardRef = useRef<HTMLDivElement | null>(null);
  const [allCharges, setAllCharges] = useState<{tenant_id: string; billing_month: string; amount: number; description: string}[]>([]);
  const [manualCharges, setManualCharges] = useState<Array<{
    id: string;
    expense_id?: string | null;
    tenant_id: string;
    billing_month: string;
    amount: number;
    description: string;
    expense_date: string;
    tenant: TenantSummary | null;
  }>>([]);
  const [waivedSet, setWaivedSet] = useState<Set<string>>(new Set());

  const [formData, setFormData] = useState({
    tenant_id: '',
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    billing_month: getCurrentBillingMonth(),
    status: 'paid' as 'paid' | 'pending',
    is_balance_waived: false,
  });
  const [chargeFormData, setChargeFormData] = useState({
    tenant_id: '',
    description: '',
    amount: '',
    billing_month: getCurrentBillingMonth(),
    charge_date: new Date().toISOString().split('T')[0],
  });

  const attachTenantDisplayData = (
    tenantRows: Array<{ id: string; name: string; email?: string; phone?: string; bed_id: string; rent_amount: number | string; prorated_rent?: number | string | null; start_date: string; end_date: string | null; is_active?: boolean }>,
    bedRows: BedRecord[],
    roomRows: RoomRecord[],
  ): TenantSummary[] => tenantRows.map((tenant) => {
    const bed = bedRows.find((item) => item.id === tenant.bed_id) ?? null;
    const room = bed ? roomRows.find((item) => item.id === bed.room_id) ?? null : null;

    return {
      ...tenant,
      bed,
      room,
    };
  });

  const fetchData = useCallback(async () => {
    if (!selectedPropertyId) {
      setPayments([]);
      setTenants([]);
      setPaymentSchemaSupportsAudit(false);
      setFetchError('');
      setLoading(false);
      return;
    }

    const cacheKey = `${PAYMENTS_CACHE_KEY}:${selectedPropertyId}`;
    const cached = getCachedAdminData<{
      payments: PaymentRecord[];
      tenants: TenantSummary[];
      paymentSchemaSupportsAudit: boolean;
    }>(cacheKey);

    if (cached) {
      setPayments(cached.payments);
      setTenants(cached.tenants);
      setPaymentSchemaSupportsAudit(cached.paymentSchemaSupportsAudit);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setFetchError('');

    try {
      let paymentRows: PaymentRecord[] = [];
      let paymentAuditEnabled = true;

      let tenantRows:
        | Array<{ id: string; name: string; email?: string; phone?: string; bed_id: string; rent_amount: number | string; prorated_rent?: number | string | null; start_date: string; end_date: string | null; is_active?: boolean }>
        | null = null;
      let tenantErrorMessage = '';

      const tenantQueries = [
        ENHANCED_TENANT_SELECT,
        LEGACY_ENHANCED_TENANT_SELECT,
        BASE_TENANT_SELECT,
        LEGACY_TENANT_SELECT,
      ] as const;

      for (const tenantSelect of tenantQueries) {
        const tenantResult = await withSupabaseTimeout(
          supabase
            .from('tenants')
            .select(tenantSelect)
            .eq('property_id', selectedPropertyId)
            .order('start_date', { ascending: false }),
          'Tenants took too long to load. Please try again.',
        );

        if (!tenantResult.error) {
          tenantRows = (tenantResult.data ?? []) as unknown as Array<{ id: string; name: string; email?: string; phone?: string; bed_id: string; rent_amount: number | string; prorated_rent?: number | string | null; start_date: string; end_date: string | null; is_active?: boolean }>;
          break;
        }

        if (!isMissingColumnError(tenantResult.error)) {
          tenantErrorMessage = tenantResult.error.message || 'Unable to load tenants.';
          break;
        }
      }

      const [
        { data: bedRows, error: bedError },
        { data: roomRows, error: roomError },
      ] = await withSupabaseTimeout(
        Promise.all([
          supabase.from('beds').select('id, bed_number, room_id, property_id').eq('property_id', selectedPropertyId),
          supabase.from('rooms').select('id, name').eq('property_id', selectedPropertyId),
        ]),
        'Beds and rooms took too long to load. Please try again.',
      );

      if (tenantErrorMessage) {
        console.error('Tenant fetch error:', tenantErrorMessage);
        setFetchError((current) => current || tenantErrorMessage);
      }
      if (bedError) {
        console.error('Bed fetch error:', bedError);
        setFetchError((current) => current || bedError.message || 'Unable to load beds.');
      }
      if (roomError) {
        console.error('Room fetch error:', roomError);
        setFetchError((current) => current || roomError.message || 'Unable to load rooms.');
      }

      const enhancedTenants = attachTenantDisplayData(
        (tenantRows ?? []) as Array<{ id: string; name: string; email?: string; phone?: string; bed_id: string; rent_amount: number | string; prorated_rent?: number | string | null; start_date: string; end_date: string | null; is_active?: boolean }>,
        (bedRows ?? []) as BedRecord[],
        (roomRows ?? []) as RoomRecord[],
      );
      const tenantFileResult = await withSupabaseTimeout(
        supabase
          .from('tenants')
          .select('id, photo_url')
          .eq('property_id', selectedPropertyId),
        'Tenant photos took too long to load. Please try again.',
      );
      if (!tenantFileResult.error) {
        const fileMap = new Map(
          ((tenantFileResult.data ?? []) as Array<{ id: string; photo_url?: string | null }>)
            .map((row) => [row.id, row.photo_url ?? null]),
        );
        enhancedTenants.forEach((tenant) => {
          tenant.photo_url = fileMap.get(tenant.id) ?? null;
        });
      }

      const propertyTenantIds = enhancedTenants.map((tenant) => tenant.id);
      if (propertyTenantIds.length > 0) {
        const enhancedPayments = await withSupabaseTimeout(
          supabase
            .from('payments')
            .select(ENHANCED_PAYMENT_SELECT)
            .in('tenant_id', propertyTenantIds)
            .order('payment_date', { ascending: false }),
          'Payments took too long to load. Please try again.',
        );

        if (enhancedPayments.error) {
          if (isMissingColumnError(enhancedPayments.error)) {
            paymentAuditEnabled = false;
            const fallbackPayments = await withSupabaseTimeout(
              supabase
                .from('payments')
                .select(BASE_PAYMENT_SELECT)
                .in('tenant_id', propertyTenantIds)
                .order('payment_date', { ascending: false }),
              'Payments took too long to load. Please try again.',
            );

            if (fallbackPayments.error) {
              console.error('Payment fetch error:', fallbackPayments.error);
              setFetchError((current) => current || fallbackPayments.error.message || 'Unable to load payment records.');
            } else {
              paymentRows = (fallbackPayments.data ?? []) as PaymentRecord[];
            }
          } else {
            console.error('Payment fetch error:', enhancedPayments.error);
            setFetchError((current) => current || enhancedPayments.error.message || 'Unable to load payment records.');
          }
        } else {
          paymentRows = (enhancedPayments.data ?? []) as PaymentRecord[];
        }
      }

      const waivedCycles = new Set<string>();
      paymentRows.forEach((payment) => {
        if (payment.status !== 'paid') return;
        if (payment.is_balance_waived) {
          waivedCycles.add(`${payment.tenant_id}:${payment.billing_month}`);
        }
      });

      const chargesArray: ChargeRecord[] = [];
      if (propertyTenantIds.length > 0) {
        const { data: charges } = await withSupabaseTimeout(
          supabase
            .from('tenant_charges')
            .select(`id, tenant_id, billing_month, amount, expense_id, expenses ( description, expense_date, category )`)
            .in('tenant_id', propertyTenantIds),
          'Extra charges took too long to load. Please try again.',
        );
        if (charges) {
          chargesArray.push(...charges);
        }
      }

      const enhancedPaymentsWithStatus = paymentRows.map((payment) => {
        const tenant = enhancedTenants.find((item) => item.id === payment.tenant_id) ?? null;
        const cycleSummary = tenant
          ? calculateTenantBalanceForMonth(tenant, payment.billing_month, paymentRows, chargesArray)
          : null;

        return {
          ...payment,
          tenant,
          cycleDue: cycleSummary?.dueAmount ?? 0,
          cyclePaid: cycleSummary?.paidAmount ?? 0,
          cycleStatus: cycleSummary?.status ?? 'unpaid',
        };
      });

      setAllCharges(chargesArray.map((c) => ({ 
        tenant_id: c.tenant_id, 
        billing_month: c.billing_month, 
        amount: Number(c.amount),
        description: getChargeDescription(c) || 'Extra Charge'
      })));
      setManualCharges(
        chargesArray
          .filter((charge: ChargeRecord) => getChargeCategory(charge) === 'Manual Charge')
          .map((charge: ChargeRecord) => ({
            id: charge.id ?? `${charge.tenant_id}-${charge.billing_month}-${charge.amount}`,
            expense_id: charge.expense_id ?? null,
            tenant_id: charge.tenant_id,
            billing_month: charge.billing_month,
            amount: Number(charge.amount),
            description: getChargeDescription(charge) || 'Manual Charge',
            expense_date: getChargeExpenseDate(charge) || charge.billing_month,
            tenant: enhancedTenants.find((tenant) => tenant.id === charge.tenant_id) ?? null,
          }))
          .sort((left, right) => right.expense_date.localeCompare(left.expense_date)),
      );
      setWaivedSet(waivedCycles);

      setPaymentSchemaSupportsAudit(paymentAuditEnabled);
      setTenants(enhancedTenants);
      setPayments(enhancedPaymentsWithStatus);
      setCachedAdminData(cacheKey, {
        payments: enhancedPaymentsWithStatus,
        tenants: enhancedTenants,
        paymentSchemaSupportsAudit: paymentAuditEnabled,
      });
    } catch (nextError) {
      console.error('Payments fetch crash:', nextError);
      setFetchError(nextError instanceof Error ? nextError.message : 'Unable to load payment records.');
    } finally {
      setLoading(false);
    }
  }, [selectedPropertyId]);

  const buildReceiptData = useCallback((payment: {
    id: string;
    amount: number;
    billing_month: string;
    payment_date: string;
    status: 'paid' | 'pending';
    tenant: TenantSummary | null;
    cycleDue?: number;
    cyclePaid?: number;
  }): PaymentReceiptData => {
    const tenant = payment.tenant;
    const cyclePaid = payments
      .filter((item) => item.status === 'paid' && item.tenant_id === tenant?.id && item.billing_month === payment.billing_month)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const updatedCyclePaid = payment.status === 'paid'
      ? Math.max(cyclePaid, payment.amount)
      : cyclePaid;
    const cycleSummary = tenant
      ? calculateTenantBalanceForMonth(tenant, payment.billing_month, payments, allCharges)
      : null;
    const dueAmount = payment.cycleDue ?? cycleSummary?.dueAmount ?? 0;
    const isWaived = cycleSummary?.isBalanceWaived ?? (tenant ? waivedSet.has(`${tenant.id}:${payment.billing_month}`) : false);
    const remainingAmount = isWaived ? 0 : Math.max(dueAmount - updatedCyclePaid, 0);

    return {
      receiptNumber: payment.id.slice(0, 8).toUpperCase(),
      siteName: settings.site_name,
      companyName: settings.company_name,
      supportEmail: settings.support_email,
      supportPhone: settings.support_phone,
      tenantName: tenant?.name ?? 'Tenant',
      tenantEmail: tenant?.email ?? '',
      tenantPhone: tenant?.phone ?? '',
      roomName: tenant?.room?.name ?? 'Unknown room',
      bedNumber: tenant?.bed?.bed_number ?? 'Unknown',
      billingMonth: payment.billing_month,
      paymentDate: payment.payment_date,
      amount: payment.amount,
      dueAmount,
      paidAmount: updatedCyclePaid,
      remainingAmount,
      previousBalance: cycleSummary?.previousBalance ?? 0,
      paymentStatus: payment.status === 'paid' ? getPaymentStatusLabel(getMonthlyPaymentStatus(dueAmount, updatedCyclePaid, isWaived)) : 'Pending',
      extraCharges: tenant ? allCharges
        .filter((c) => c.tenant_id === tenant.id && c.billing_month === payment.billing_month)
        .map(c => ({ description: c.description, amount: c.amount })) : [],
    };
  }, [payments, settings, allCharges, waivedSet]);

  const openWhatsappShare = (receipt: PaymentReceiptData) => {
    window.open(getWhatsappShareLink(receipt), '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  useEffect(() => {
    const cachedAlerts = getCachedAdminAlerts(selectedPropertyId);
    if (cachedAlerts) {
      setAlerts(cachedAlerts);
    }

    fetchAdminAlerts(selectedPropertyId)
      .then(setAlerts)
      .catch((error) => console.error('Payment alerts error:', error));
  }, [payments, selectedPropertyId]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedPropertyId) {
      setFormError('Please select a property before recording a payment.');
      return;
    }

    if (!formData.tenant_id) {
      setFormError('Please select a tenant.');
      return;
    }

    const parsedAmount = Number(formData.amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid payment amount.');
      return;
    }

    const paymentPayload: Record<string, string | number | boolean | null> = {
      tenant_id: formData.tenant_id,
      amount: parsedAmount,
      payment_date: formData.payment_date,
      billing_month: formData.billing_month,
      status: formData.status,
      is_balance_waived: formData.is_balance_waived,
    };

    if (paymentSchemaSupportsAudit) {
      paymentPayload.updated_by = user?.id ?? null;
      paymentPayload.updated_at = new Date().toISOString();
    }

    const { data: savedPayment, error } = editingPaymentId
      ? await supabase.from('payments').update(paymentPayload).eq('id', editingPaymentId).select('id').single()
      : await supabase.from('payments').insert([paymentPayload]).select('id').single();

    if (error) {
      console.error('Payment insert error:', error);
      if (isMissingColumnError(error)) {
         setFormError('Please run the provided SQL migration script to add the is_balance_waived column.');
      } else {
         setFormError(error.message || 'Unable to save payment record.');
      }
      return;
    }

    const selectedTenant = tenants.find((tenant) => tenant.id === formData.tenant_id);
    await writeActivityLog({
      action: editingPaymentId ? 'payment.updated' : 'payment.created',
      entityType: 'payment',
      entityId: savedPayment?.id ?? editingPaymentId ?? '',
      description: editingPaymentId
        ? `Updated payment for ${selectedTenant?.name ?? 'tenant'} for ${format(new Date(formData.billing_month), 'MMM yyyy')}.`
        : `Recorded payment for ${selectedTenant?.name ?? 'tenant'} for ${format(new Date(formData.billing_month), 'MMM yyyy')}.`,
      actorId: user?.id,
    });

    invalidateAdminDataCache();
    await fetchData();
    setShowForm(false);
    setEditingPaymentId(null);
    setFormData({
      tenant_id: '',
      amount: '',
      payment_date: new Date().toISOString().split('T')[0],
      billing_month: getCurrentBillingMonth(),
      status: 'paid',
      is_balance_waived: false,
    });
  };

  const handleRecordManualCharge = async (e: React.FormEvent) => {
    e.preventDefault();
    setChargeFormError('');

    if (!selectedPropertyId) {
      setChargeFormError('Please select a property before recording a manual charge.');
      return;
    }

    if (!chargeFormData.tenant_id) {
      setChargeFormError('Please select a tenant.');
      return;
    }

    if (!chargeFormData.description.trim()) {
      setChargeFormError('Please enter a charge description.');
      return;
    }

    const parsedAmount = Number(chargeFormData.amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setChargeFormError('Please enter a valid charge amount.');
      return;
    }

    let savedExpenseId = editingManualChargeId
      ? manualCharges.find((charge) => charge.id === editingManualChargeId)?.expense_id ?? null
      : null;

    if (editingManualChargeId && savedExpenseId) {
      const { error: expenseUpdateError } = await supabase
        .from('expenses')
        .update({
          description: chargeFormData.description.trim(),
          amount: parsedAmount,
          expense_date: chargeFormData.charge_date,
          category: 'Manual Charge',
        })
        .eq('id', savedExpenseId);

      if (expenseUpdateError) {
        console.error('Manual charge expense update error:', expenseUpdateError);
        setChargeFormError(expenseUpdateError.message || 'Unable to update the manual charge.');
        return;
      }
    } else {
      const { data: savedExpense, error: expenseError } = await supabase
        .from('expenses')
        .insert([{
          description: chargeFormData.description.trim(),
          amount: parsedAmount,
          expense_date: chargeFormData.charge_date,
          category: 'Manual Charge',
        }])
        .select('id')
        .single();

      if (expenseError) {
        console.error('Manual charge expense insert error:', expenseError);
        setChargeFormError(expenseError.message || 'Unable to save the manual charge.');
        return;
      }

      savedExpenseId = savedExpense.id;
    }

    const chargePayload = {
      tenant_id: chargeFormData.tenant_id,
      expense_id: savedExpenseId,
      amount: parsedAmount,
      billing_month: chargeFormData.billing_month,
    };

    const { error: chargeError } = editingManualChargeId
      ? await supabase
        .from('tenant_charges')
        .update(chargePayload)
        .eq('id', editingManualChargeId)
      : await supabase
        .from('tenant_charges')
        .insert([chargePayload]);

    if (chargeError) {
      console.error('Manual tenant charge insert error:', chargeError);
      setChargeFormError(chargeError.message || 'Unable to attach the manual charge to the tenant.');
      return;
    }

    const selectedTenant = tenants.find((tenant) => tenant.id === chargeFormData.tenant_id);
    await writeActivityLog({
      action: editingManualChargeId ? 'tenant_charge.updated' : 'tenant_charge.created',
      entityType: 'tenant_charge',
      entityId: editingManualChargeId ?? savedExpenseId ?? '',
      description: `${editingManualChargeId ? 'Updated' : 'Recorded'} manual charge "${chargeFormData.description.trim()}" for ${selectedTenant?.name ?? 'tenant'} for ${format(new Date(chargeFormData.billing_month), 'MMM yyyy')}.`,
      actorId: user?.id,
    });

    invalidateAdminDataCache();
    await fetchData();
    setShowChargeForm(false);
    setEditingManualChargeId(null);
    setChargeFormData({
      tenant_id: '',
      description: '',
      amount: '',
      billing_month: getCurrentBillingMonth(),
      charge_date: new Date().toISOString().split('T')[0],
    });
  };

  const handleTenantSelect = (id: string) => {
    const tenant = tenants.find((item) => item.id === id);
    if (!tenant) return;
    const cycleSummary = calculateTenantBalanceForMonth(tenant, formData.billing_month, payments, allCharges);

    setFormData({
      ...formData,
      tenant_id: id,
      amount: String(cycleSummary.remainingAmount),
    });
    setFormError('');
  };

  const markAsPaid = async (id: string) => {
    const payload: Record<string, string | null> = { status: 'paid' };
    if (paymentSchemaSupportsAudit) {
      payload.updated_by = user?.id ?? null;
      payload.updated_at = new Date().toISOString();
    }

    const { error } = await supabase.from('payments').update(payload).eq('id', id);
    if (error) {
      console.error('Payment update error:', error);
      setFormError(error.message || 'Unable to update payment status.');
      return;
    }

    await writeActivityLog({
      action: 'payment.marked_paid',
      entityType: 'payment',
      entityId: id,
      description: 'Marked payment record as paid.',
      actorId: user?.id,
    });
    invalidateAdminDataCache();
    await fetchData();
  };

  const handleEditPayment = (payment: PaymentRecord) => {
    setEditingPaymentId(payment.id);
    setShowForm(true);
    setFormError('');
    setFormData({
      tenant_id: payment.tenant_id,
      amount: String(payment.amount),
      payment_date: payment.payment_date,
      billing_month: payment.billing_month,
      status: payment.status,
      is_balance_waived: payment.is_balance_waived || false,
    });
    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleEditManualCharge = (charge: {
    id: string;
    tenant_id: string;
    billing_month: string;
    amount: number;
    description: string;
    expense_date: string;
  }) => {
    setEditingManualChargeId(charge.id);
    setShowChargeForm(true);
    setShowForm(false);
    setChargeFormError('');
    setChargeFormData({
      tenant_id: charge.tenant_id,
      description: charge.description,
      amount: String(charge.amount),
      billing_month: charge.billing_month,
      charge_date: charge.expense_date,
    });
    window.requestAnimationFrame(() => {
      chargeFormCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleDeleteManualCharge = async (chargeId: string) => {
    const charge = manualCharges.find((item) => item.id === chargeId);
    if (!charge) return;

    const { error: tenantChargeDeleteError } = await supabase
      .from('tenant_charges')
      .delete()
      .eq('id', chargeId);

    if (tenantChargeDeleteError) {
      console.error('Manual charge delete error:', tenantChargeDeleteError);
      setChargeFormError(tenantChargeDeleteError.message || 'Unable to delete the manual charge.');
      return;
    }

    if (charge.expense_id) {
      const { error: expenseDeleteError } = await supabase
        .from('expenses')
        .delete()
        .eq('id', charge.expense_id);

      if (expenseDeleteError) {
        console.error('Manual charge expense delete error:', expenseDeleteError);
        setChargeFormError(expenseDeleteError.message || 'Manual charge was removed from tenant balance, but the linked expense could not be deleted.');
        return;
      }
    }

    await writeActivityLog({
      action: 'tenant_charge.deleted',
      entityType: 'tenant_charge',
      entityId: chargeId,
      description: `Deleted manual charge "${charge.description}" for ${charge.tenant?.name ?? 'tenant'}.`,
      actorId: user?.id,
    });

    invalidateAdminDataCache();
    if (editingManualChargeId === chargeId) {
      setEditingManualChargeId(null);
      setShowChargeForm(false);
      setChargeFormData({
        tenant_id: '',
        description: '',
        amount: '',
        billing_month: getCurrentBillingMonth(),
        charge_date: new Date().toISOString().split('T')[0],
      });
    }
    await fetchData();
  };

  const handleDeletePayment = async (paymentId: string) => {
    const payment = payments.find((item) => item.id === paymentId);
    const { error } = await supabase.from('payments').delete().eq('id', paymentId);
    if (error) {
      console.error('Payment delete error:', error);
      setFormError(error.message || 'Unable to delete payment record.');
      return;
    }

    await writeActivityLog({
      action: 'payment.deleted',
      entityType: 'payment',
      entityId: paymentId,
      description: `Deleted payment record for ${payment?.tenant?.name ?? 'tenant'}.`,
      actorId: user?.id,
    });

    invalidateAdminDataCache();
    if (editingPaymentId === paymentId) {
      setEditingPaymentId(null);
      setShowForm(false);
      setFormData({
        tenant_id: '',
        amount: '',
        payment_date: new Date().toISOString().split('T')[0],
        billing_month: getCurrentBillingMonth(),
        status: 'paid',
        is_balance_waived: false,
      });
    }

    await fetchData();
  };

  const isAllMonths = monthFilter.trim().length === 0;
  const effectiveMonthStart = useMemo(() => (
    isAllMonths ? startOfMonth(new Date()) : startOfMonth(new Date(`${monthFilter}-01`))
  ), [isAllMonths, monthFilter]);
  const effectiveMonthEnd = useMemo(() => lastDayOfMonth(effectiveMonthStart), [effectiveMonthStart]);
  const selectedBillingMonth = useMemo(() => format(effectiveMonthStart, 'yyyy-MM-dd'), [effectiveMonthStart]);
  const selectedMonthLabel = isAllMonths ? 'All Months' : format(effectiveMonthStart, 'MMMM yyyy');

  const activeTenantsForMonth = useMemo(() => (
    isAllMonths
      ? []
      : (
    tenants.filter((tenant) => (
      tenant.is_active !== false &&
      tenant.start_date <= format(effectiveMonthEnd, 'yyyy-MM-dd') &&
      (!tenant.end_date || tenant.end_date >= format(effectiveMonthStart, 'yyyy-MM-dd'))
    ))
      )
  ), [effectiveMonthEnd, effectiveMonthStart, isAllMonths, tenants]);

  const monthlyTenantStatuses = useMemo(() => {
    return activeTenantsForMonth.map((tenant) => {
      const cycleSummary = calculateTenantBalanceForMonth(tenant, selectedBillingMonth, payments, allCharges);
      const due = cycleSummary.dueAmount;
      const paid = cycleSummary.paidAmount;
      const remaining = cycleSummary.remainingAmount;
      const cycleStatus = cycleSummary.status;

      return {
        ...tenant,
        rentDue: cycleSummary.baseDue,
        otherCharges: cycleSummary.extraCharges + cycleSummary.previousBalance,
        due,
        paid,
        remaining,
        cycleStatus,
      };
    });
  }, [activeTenantsForMonth, selectedBillingMonth, payments, allCharges]);

  const filteredPayments = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return payments.filter((payment) => {
      const matchesSearch = normalizedSearch.length === 0 || [
        payment.tenant?.name ?? '',
        payment.tenant?.email ?? '',
        payment.tenant?.phone ?? '',
        payment.tenant?.room?.name ?? '',
        payment.tenant?.bed?.bed_number ?? '',
        format(new Date(payment.billing_month), 'MMM yyyy'),
        format(new Date(payment.payment_date), 'MMM dd, yyyy'),
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesMonth = isAllMonths || payment.billing_month === selectedBillingMonth;
      const matchesCycleStatus = cycleStatusFilter === 'all' || payment.cycleStatus === cycleStatusFilter;
      const matchesTenant = tenantFilter === 'all' || payment.tenant_id === tenantFilter;

      return matchesSearch && matchesMonth && matchesCycleStatus && matchesTenant;
    });
  }, [cycleStatusFilter, isAllMonths, payments, searchQuery, selectedBillingMonth, tenantFilter]);

  const filteredMonthlyTenantStatuses = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return monthlyTenantStatuses.filter((tenant) => {
      const matchesSearch = normalizedSearch.length === 0 || [
        tenant.name,
        tenant.email ?? '',
        tenant.phone ?? '',
        tenant.room?.name ?? '',
        tenant.bed?.bed_number ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesCycleStatus = cycleStatusFilter === 'all' || tenant.cycleStatus === cycleStatusFilter;
      const matchesTenant = tenantFilter === 'all' || tenant.id === tenantFilter;

      return matchesSearch && matchesCycleStatus && matchesTenant;
    });
  }, [cycleStatusFilter, monthlyTenantStatuses, searchQuery, tenantFilter]);
  const sortedTenants = useMemo(() => (
    [...tenants].sort((left, right) => left.name.localeCompare(right.name))
  ), [tenants]);
  const filteredManualCharges = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return manualCharges.filter((charge) => {
      const matchesSearch = normalizedSearch.length === 0 || [
        charge.tenant?.name ?? '',
        charge.tenant?.email ?? '',
        charge.tenant?.phone ?? '',
        charge.tenant?.room?.name ?? '',
        charge.tenant?.bed?.bed_number ?? '',
        charge.description,
        format(new Date(charge.billing_month), 'MMM yyyy'),
        format(new Date(charge.expense_date), 'MMM dd, yyyy'),
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesMonth = isAllMonths || charge.billing_month === selectedBillingMonth;
      const matchesTenant = tenantFilter === 'all' || charge.tenant_id === tenantFilter;

      return matchesSearch && matchesMonth && matchesTenant;
    });
  }, [isAllMonths, manualCharges, searchQuery, selectedBillingMonth, tenantFilter]);

  const selectedTenant = tenants.find((tenant) => tenant.id === formData.tenant_id) ?? null;
  const collectedThisMonth = monthlyTenantStatuses.reduce((sum, tenant) => sum + tenant.paid, 0);
  const expectedThisMonth = monthlyTenantStatuses.reduce((sum, tenant) => sum + tenant.due, 0);
  const remainingThisMonth = monthlyTenantStatuses.reduce((sum, tenant) => sum + tenant.remaining, 0);
  const unpaidTenantCount = monthlyTenantStatuses.filter((tenant) => tenant.cycleStatus === 'unpaid').length;
  const partialTenantCount = monthlyTenantStatuses.filter((tenant) => tenant.cycleStatus === 'partial').length;

  const exportPaymentsCsv = () => {
    downloadCsv(
      `payments-${isAllMonths ? 'all' : selectedBillingMonth}.csv`,
      ['Tenant', 'Email', 'Room', 'Bed', 'Billing Month', 'Payment Date', 'Amount', 'Cycle Status', 'Record Status'],
      filteredPayments.map((payment) => [
        payment.tenant?.name ?? 'Unknown tenant',
        payment.tenant?.email ?? '',
        payment.tenant?.room?.name ?? 'Unknown room',
        payment.tenant?.bed?.bed_number ?? 'Unknown bed',
        payment.billing_month,
        payment.payment_date,
        Number(payment.amount),
        getPaymentStatusLabel(payment.cycleStatus ?? 'unpaid'),
        payment.status,
      ]),
    );
  };

  const exportUnpaidCsv = () => {
    const rows = filteredMonthlyTenantStatuses
      .filter((tenant) => tenant.remaining > 0)
      .map((tenant) => [
        tenant.name,
        tenant.email ?? '',
        tenant.room?.name ?? 'Unknown room',
        tenant.bed?.bed_number ?? 'Unknown bed',
        format(new Date(selectedBillingMonth), 'MMM yyyy'),
        tenant.due,
        tenant.paid,
        tenant.remaining,
        getPaymentStatusLabel(tenant.cycleStatus),
      ]);

    downloadCsv(
      `unpaid-tenants-${isAllMonths ? 'all' : selectedBillingMonth}.csv`,
      ['Tenant', 'Email', 'Room', 'Bed', 'Billing Month', 'Due', 'Paid', 'Remaining', 'Status'],
      rows,
    );
  };

  const handleOpenReceiptForPayment = (payment: PaymentRecord) => {
    const receipt = buildReceiptData({
      id: payment.id,
      amount: Number(payment.amount),
      billing_month: payment.billing_month,
      payment_date: payment.payment_date,
      status: payment.status,
      tenant: payment.tenant ?? null,
    });
    openPaymentReceipt(receipt);
  };

  const handleShareReceiptForPayment = (payment: PaymentRecord) => {
    const receipt = buildReceiptData({
      id: payment.id,
      amount: Number(payment.amount),
      billing_month: payment.billing_month,
      payment_date: payment.payment_date,
      status: payment.status,
      tenant: payment.tenant ?? null,
    });
    openWhatsappShare(receipt);
  };

  if (loading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading payments...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are reconciling tenants, beds, rooms, and this month&apos;s transactions.</p>
        </Card>
      </div>
    );
  }

  if (propertiesLoading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading properties...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are loading the property list before opening the payment ledger.</p>
        </Card>
      </div>
    );
  }

  if (!selectedPropertyId) {
    return (
      <div className="page-container">
        <Card style={{ borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>No property selected</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            {propertiesError || 'Create your first property in Settings to start recording rent payments.'}
          </p>
        </Card>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="page-container">
        <Card style={{ borderColor: 'rgba(239, 68, 68, 0.35)' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Unable to load the payments page</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{fetchError}</p>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
            This usually points to a schema, RLS, or data issue rather than an empty ledger.
          </p>
          <Button onClick={() => void fetchData()}>Retry</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Rent Payments</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Track collections, see who is unpaid this month, and export reports for {selectedProperty?.name ?? 'the selected property'}.
          </p>
        </div>
        <div className="admin-toolbar">
          <div className="toolbar-month-field">
            <Input
              type="month"
              value={monthFilter}
              aria-label="Billing month"
              title="Billing month"
              onChange={(e) => setMonthFilter(e.target.value)}
            />
          </div>
          <Button variant={isAllMonths ? 'primary' : 'secondary'} onClick={() => setMonthFilter('')}>
            All
          </Button>
          <Button
            variant="secondary"
            onClick={() => setShowFilters((value) => !value)}
            aria-label={showFilters ? 'Hide search and filters' : 'Show search and filters'}
            title={showFilters ? 'Hide search and filters' : 'Show search and filters'}
          >
            <Search size={16} />
          </Button>
          <Button className="desktop-only" variant="secondary" onClick={exportPaymentsCsv}>
            <Download size={16} /> Export Payments
          </Button>
          <Button className="desktop-only" variant="secondary" onClick={exportUnpaidCsv}>
            <Download size={16} /> Export Unpaid
          </Button>
          <MobileActionMenu
            items={[
              { label: 'Export Payments', onClick: exportPaymentsCsv },
              { label: 'Export Unpaid', onClick: exportUnpaidCsv },
            ]}
          />
          <Button
            variant="secondary"
            onClick={() => {
              setShowChargeForm((value) => {
                const nextValue = !value;
                if (nextValue) {
                  window.requestAnimationFrame(() => {
                    chargeFormCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  });
                }
                return nextValue;
              });
              setShowForm(false);
              setEditingPaymentId(null);
              if (showChargeForm) {
                setEditingManualChargeId(null);
                setChargeFormData({
                  tenant_id: '',
                  description: '',
                  amount: '',
                  billing_month: getCurrentBillingMonth(),
                  charge_date: new Date().toISOString().split('T')[0],
                });
              }
              setChargeFormError('');
            }}
            style={{ borderColor: 'rgba(245, 158, 11, 0.35)', color: 'var(--warning)' }}
          >
            <PlusCircle size={16} /> Manual Charge
          </Button>
          <Button onClick={() => {
            setShowForm((value) => !value);
            setShowChargeForm(false);
          }}>
            {showForm ? 'Cancel' : 'Record Payment'}
          </Button>
        </div>
      </div>

      {!paymentSchemaSupportsAudit && (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Payment audit stamps need one SQL migration</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            The page is fully usable now. `payments.updated_at` and `payments.updated_by` will start saving automatically after you add those columns in Supabase.
          </p>
        </Card>
      )}

      {(alerts.unpaidTenants.length > 0 || alerts.expiringTenants.length > 0) && (
        <Card style={{ marginBottom: '1rem', borderColor: 'rgba(245, 158, 11, 0.35)', padding: '0.9rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ color: 'var(--text-secondary)' }}>
              {alerts.unpaidTenants.length > 0 ? `${alerts.unpaidTenants.length} unpaid or partial this month. ` : ''}
              {alerts.expiringTenants.length > 0 ? `${alerts.expiringTenants.length} expiring within 7 days.` : ''}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {alerts.unpaidTenants.length > 0 ? <span className="badge badge-danger">{alerts.unpaidTenants.length} Unpaid</span> : null}
              {alerts.expiringTenants.length > 0 ? <span className="badge badge-warning">{alerts.expiringTenants.length} Expiring</span> : null}
            </div>
          </div>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Collected</div>
          <h2 style={{ marginTop: '0.5rem' }}>{formatCurrency(isAllMonths ? filteredPayments.reduce((sum, payment) => sum + Number(payment.amount), 0) : collectedThisMonth)}</h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>{isAllMonths ? 'Transactions' : 'Expected'}</div>
          <h2 style={{ marginTop: '0.5rem' }}>{isAllMonths ? filteredPayments.length : formatCurrency(expectedThisMonth)}</h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>{isAllMonths ? 'Pending Records' : 'Remaining'}</div>
          <h2 style={{ marginTop: '0.5rem', color: 'var(--warning)' }}>
            {isAllMonths ? filteredPayments.filter((payment) => payment.status === 'pending').length : formatCurrency(remainingThisMonth)}
          </h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>{isAllMonths ? 'Visible Tenants' : 'Unpaid / Partial'}</div>
          <h2 style={{ marginTop: '0.5rem' }}>
            {isAllMonths ? new Set(filteredPayments.map((payment) => payment.tenant_id)).size : `${unpaidTenantCount} / ${partialTenantCount}`}
          </h2>
        </Card>
      </div>

      {showFilters && (
      <Card className="toolbar-panel">
        <div className="toolbar-panel-header">
          <div>
            <h3 style={{ marginBottom: '0.35rem' }}>Search and filters</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Search the payment ledger separately from the record form.</p>
          </div>
          <Button variant="secondary" onClick={() => {
            setSearchQuery('');
            setCycleStatusFilter('all');
            setTenantFilter('all');
            setShowFilters(false);
          }}>
            Clear Filters
          </Button>
        </div>

        <div className="toolbar-panel-grid">
          <Input
            label="Search"
            placeholder="Tenant, email, room, or bed"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="form-group">
            <label className="form-label">Cycle Status</label>
            <select className="form-select" value={cycleStatusFilter} onChange={(e) => setCycleStatusFilter(e.target.value)}>
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="partial">Partial</option>
              <option value="unpaid">Unpaid</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Tenant</label>
            <select className="form-select" value={tenantFilter} onChange={(e) => setTenantFilter(e.target.value)}>
              <option value="all">All tenants</option>
              {sortedTenants.map((tenant) => (
                <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>
      )}

      {showForm && (
        <Card ref={formCardRef} style={{ marginBottom: '2rem', borderColor: editingPaymentId ? 'var(--primary)' : undefined }}>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>{editingPaymentId ? 'Edit Payment' : 'Record Payment'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {editingPaymentId ? 'You are editing the selected payment row below.' : 'Record a new payment entry for a tenant.'}
              </p>
            </div>
            {editingPaymentId && (
              <div className="badge badge-warning">
                Editing Mode
              </div>
            )}
          </div>
          <form onSubmit={handleRecordPayment} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Tenant</label>
              <select className="form-select" required value={formData.tenant_id} onChange={(e) => handleTenantSelect(e.target.value)}>
                <option value="">Select Tenant</option>
                {sortedTenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} | {tenant.room?.name} | Bed {tenant.bed?.bed_number} | Rent {formatCurrency(Number(tenant.rent_amount))}
                  </option>
                ))}
              </select>
            </div>

            <Input
              type="number"
              label="Amount (AED)"
              required
              value={formData.amount}
              onChange={(e) => setFormData({ ...formData, amount: e.target.value })}
            />

            <Input
              type="month"
              label="Rent Month"
              required
              value={formData.billing_month.slice(0, 7)}
              onChange={(e) => {
                const nextBillingMonth = `${e.target.value}-01`;
                const tenant = tenants.find((item) => item.id === formData.tenant_id);
                if (tenant) {
                  const cycleSummary = calculateTenantBalanceForMonth(tenant, nextBillingMonth, payments, allCharges);
                  setFormData({
                    ...formData,
                    billing_month: nextBillingMonth,
                    amount: String(cycleSummary.remainingAmount),
                  });
                } else {
                  setFormData({ ...formData, billing_month: nextBillingMonth });
                }
              }}
            />

            <Input
              type="date"
              label="Payment Date"
              required
              value={formData.payment_date}
              onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
            />

            <div className="form-group">
              <label className="form-label">Record Status</label>
              <select className="form-select" value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as 'paid' | 'pending' })}>
                <option value="paid">Paid</option>
                <option value="pending">Pending</option>
              </select>
            </div>

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <input
                  type="checkbox"
                  id="waive_balance"
                  checked={formData.is_balance_waived}
                  onChange={(e) => setFormData({ ...formData, is_balance_waived: e.target.checked })}
                  style={{ width: '1.2rem', height: '1.2rem', cursor: 'pointer' }}
                />
                <label htmlFor="waive_balance" style={{ cursor: 'pointer', margin: 0, fontWeight: 500 }}>
                  Consider remaining balance as waived (mark as fully paid)
                </label>
              </div>

              <Button variant="primary" type="submit" style={{ height: '42px' }}>
                {editingPaymentId ? 'Update Payment' : 'Save Record'}
              </Button>
            </div>
          </form>

          {selectedTenant && (() => {
            const cycleSummary = calculateTenantBalanceForMonth(selectedTenant, formData.billing_month, payments, allCharges);
            return (
              <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Selected booking: {selectedTenant.room?.name ?? 'Unknown room'} | Bed {selectedTenant.bed?.bed_number ?? 'Unknown'} | Remaining for {format(new Date(formData.billing_month), 'MMM yyyy')}: {formatCurrency(cycleSummary.remainingAmount)}
              </div>
            );
          })()}

          {formError && (
            <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}>
              {formError}
            </div>
          )}

          <p style={{ marginTop: '0.75rem', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
            If you collect extra money, it is counted toward the selected rent month only. It increases collected totals, but it does not auto-carry into future months yet. After saving, use the Receipt or WhatsApp actions in the payment history row.
          </p>
        </Card>
      )}

      {showChargeForm && (
        <Card ref={chargeFormCardRef} style={{ marginBottom: '2rem', borderColor: 'rgba(245, 158, 11, 0.45)', background: 'rgba(120, 53, 15, 0.08)' }}>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>{editingManualChargeId ? 'Edit Manual Charge' : 'Record Manual Charge'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                Add opening balances, damages, utility recoveries, or any extra collectible amount for a tenant.
              </p>
            </div>
            <div className="badge badge-warning">
              Separate From Payments
            </div>
          </div>
          <form onSubmit={handleRecordManualCharge} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'flex-end' }}>
            <div className="form-group" style={{ marginBottom: 0 }}>
              <label className="form-label">Tenant</label>
              <select className="form-select" required value={chargeFormData.tenant_id} onChange={(e) => setChargeFormData({ ...chargeFormData, tenant_id: e.target.value })}>
                <option value="">Select Tenant</option>
                {sortedTenants.map((tenant) => (
                  <option key={tenant.id} value={tenant.id}>
                    {tenant.name} | {tenant.room?.name} | Bed {tenant.bed?.bed_number}
                  </option>
                ))}
              </select>
            </div>

            <Input
              label="Description"
              required
              value={chargeFormData.description}
              onChange={(e) => setChargeFormData({ ...chargeFormData, description: e.target.value })}
            />

            <Input
              type="number"
              label="Amount (AED)"
              required
              value={chargeFormData.amount}
              onChange={(e) => setChargeFormData({ ...chargeFormData, amount: e.target.value })}
            />

            <Input
              type="month"
              label="Collect In Month"
              required
              value={chargeFormData.billing_month.slice(0, 7)}
              onChange={(e) => setChargeFormData({ ...chargeFormData, billing_month: `${e.target.value}-01` })}
            />

            <Input
              type="date"
              label="Charge Date"
              required
              value={chargeFormData.charge_date}
              onChange={(e) => setChargeFormData({ ...chargeFormData, charge_date: e.target.value })}
            />

            <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '0.5rem', flexWrap: 'wrap', gap: '1rem' }}>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                This will increase the tenant balance automatically and will stay separate from payment receipts.
              </div>
              <Button type="submit" style={{ height: '42px', background: 'linear-gradient(135deg, #f59e0b, #f97316)', color: '#111827' }}>
                {editingManualChargeId ? 'Update Charge' : 'Save Charge'}
              </Button>
            </div>
          </form>

          {chargeFormError && (
            <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginTop: '0.75rem', padding: '0.75rem 1rem', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}>
              {chargeFormError}
            </div>
          )}
        </Card>
      )}

      {!isAllMonths && (
      <Card style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Unpaid Or Partial For {selectedMonthLabel}</h2>
        {filteredMonthlyTenantStatuses.filter((tenant) => tenant.remaining > 0).length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0' }}>
            {searchQuery || tenantFilter !== 'all' || cycleStatusFilter !== 'all'
              ? 'No unpaid or partial tenants match the active filters.'
              : 'Everyone active for this month is fully paid.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1.4fr) minmax(180px, 1.1fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(130px, 0.9fr) minmax(130px, 0.9fr)',
              gap: '1rem',
              padding: '0 0 0.5rem',
              borderBottom: '1px solid var(--border-light)',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              <div>Tenant</div>
              <div>Email</div>
              <div>Rent</div>
              <div>Other</div>
              <div>Paid</div>
              <div>Balance</div>
              <div>Status</div>
            </div>
            {filteredMonthlyTenantStatuses.filter((tenant) => tenant.remaining > 0).map((tenant) => (
              <div key={tenant.id} style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1.4fr) minmax(180px, 1.1fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(110px, 0.8fr) minmax(130px, 0.9fr) minmax(130px, 0.9fr)', gap: '1rem', padding: '0.9rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{tenant.name}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{tenant.room?.name} | Bed {tenant.bed?.bed_number}</div>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{tenant.email ?? 'No email saved'}</div>
                <div>{formatCurrency(tenant.rentDue ?? 0)}</div>
                <div>{formatCurrency(tenant.otherCharges ?? 0)}</div>
                <div>{formatCurrency(tenant.paid)}</div>
                <div style={{ color: 'var(--warning)', fontWeight: 600 }}>{formatCurrency(tenant.remaining)}</div>
                <div style={{ justifySelf: 'end' }}>
                  <span className={`badge ${getPaymentStatusBadgeClass(tenant.cycleStatus)}`}>
                    {getPaymentStatusLabel(tenant.cycleStatus)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
      )}

      <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)', background: 'rgba(120, 53, 15, 0.06)' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginBottom: '0.35rem' }}>Manual Charges</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Opening balances and extra collectible amounts are listed here separately from payment transactions.
          </p>
        </div>
        {filteredManualCharges.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0' }}>
            {searchQuery || tenantFilter !== 'all' || !isAllMonths
              ? 'No manual charges match the current view.'
              : 'No manual charges recorded yet.'}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(220px, 1.3fr) minmax(220px, 1.6fr) minmax(130px, 0.9fr) minmax(120px, 0.9fr) minmax(120px, 0.8fr) auto',
              gap: '1rem',
              padding: '0 0 0.5rem',
              borderBottom: '1px solid var(--border-light)',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
            }}>
              <div>Tenant</div>
              <div>Description</div>
              <div>Collect Month</div>
              <div>Charge Date</div>
              <div>Amount</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>
            {filteredManualCharges.map((charge) => (
              <div key={charge.id} style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(220px, 1.3fr) minmax(220px, 1.6fr) minmax(130px, 0.9fr) minmax(120px, 0.9fr) minmax(120px, 0.8fr) auto',
                gap: '1rem',
                padding: '0.9rem 0',
                borderBottom: '1px solid rgba(255,255,255,0.06)',
                alignItems: 'center',
              }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{charge.tenant?.name ?? 'Tenant'}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                    {charge.tenant?.room?.name ?? 'Unknown room'} | Bed {charge.tenant?.bed?.bed_number ?? 'Unknown'}
                  </div>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{charge.description}</div>
                <div>{format(new Date(charge.billing_month), 'MMM yyyy')}</div>
                <div style={{ color: 'var(--text-secondary)' }}>{format(new Date(charge.expense_date), 'MMM dd, yyyy')}</div>
                <div style={{ color: 'var(--warning)', fontWeight: 700 }}>{formatCurrency(charge.amount)}</div>
                <div style={{ justifySelf: 'end', display: 'flex', gap: '0.35rem' }}>
                  <button onClick={() => handleEditManualCharge(charge)} style={{ color: 'var(--secondary)', padding: '0.25rem' }} title="Edit manual charge">
                    <Pencil size={16} />
                  </button>
                  <button onClick={() => setPendingDeleteManualChargeId(charge.id)} style={{ color: 'var(--danger)', padding: '0.25rem' }} title="Delete manual charge">
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card style={{ overflowX: 'auto' }}>
        <div style={{ minWidth: '980px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr auto', padding: '1rem', borderBottom: '1px solid var(--border-light)', color: 'var(--text-secondary)', fontWeight: 600, fontSize: '0.875rem' }}>
          <div>Tenant</div>
          <div>Room/Bed</div>
          <div>Rent Month</div>
          <div>Payment Date</div>
          <div>Amount</div>
          <div>Status</div>
          <div>Actions</div>
        </div>

        {filteredPayments.map((payment) => (
          <div key={payment.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr auto', padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', alignItems: 'center', background: editingPaymentId === payment.id ? 'rgba(123, 97, 255, 0.08)' : payment.cycleStatus === 'unpaid' ? 'rgba(127, 29, 29, 0.12)' : payment.cycleStatus === 'partial' ? 'rgba(120, 53, 15, 0.12)' : undefined }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.55rem' }}>
              {payment.tenant?.photo_url ? (
                <img src={payment.tenant.photo_url} alt={payment.tenant?.name} style={{ width: '28px', height: '28px', borderRadius: '999px', objectFit: 'cover' }} />
              ) : null}
              <div>
              <div style={{ fontWeight: 500 }}>{payment.tenant?.name}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>{payment.tenant?.email}</div>
              </div>
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {payment.tenant?.room?.name} | Bed {payment.tenant?.bed?.bed_number}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {format(new Date(payment.billing_month), 'MMM yyyy')}
            </div>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              {format(new Date(payment.payment_date), 'MMM dd, yyyy')}
            </div>
            <div style={{ fontWeight: 600 }}>{formatCurrency(Number(payment.amount))}</div>
            <div>
              <span className={`badge ${getPaymentStatusBadgeClass(payment.cycleStatus ?? 'unpaid')}`}>
                {getPaymentStatusLabel(payment.cycleStatus ?? 'unpaid')}
              </span>
              {payment.status === 'pending' && (
                <div style={{ color: 'var(--warning)', fontSize: '0.75rem', marginTop: '0.35rem' }}>Record pending</div>
              )}
            </div>
            <div style={{ display: 'flex', gap: '0.35rem' }}>
              <button onClick={() => handleOpenReceiptForPayment(payment)} style={{ color: 'var(--primary)', padding: '0.25rem' }} title="Open receipt">
                <ReceiptText size={16} />
              </button>
              <button onClick={() => handleShareReceiptForPayment(payment)} style={{ color: 'var(--success)', padding: '0.25rem' }} title="Share via WhatsApp">
                <MessageCircle size={16} />
              </button>
              {payment.status === 'pending' && (
                <button onClick={() => void markAsPaid(payment.id)} style={{ color: 'var(--success)', background: 'var(--success-bg)', padding: '0.25rem', borderRadius: '4px' }}>
                  <CheckCircle2 size={16} />
                </button>
              )}
              <button onClick={() => handleEditPayment(payment)} style={{ color: 'var(--secondary)', padding: '0.25rem' }}>
                <Pencil size={16} />
              </button>
              <button onClick={() => setPendingDeletePaymentId(payment.id)} style={{ color: 'var(--danger)', padding: '0.25rem' }}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        {filteredPayments.length === 0 && payments.length > 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            {searchQuery || tenantFilter !== 'all' || cycleStatusFilter !== 'all'
              ? 'No payment records match the active filters for this month.'
              : 'No payment records found for the selected month.'}
          </div>
        )}

        {payments.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No payments recorded yet. Use Record Payment to add the first transaction.
          </div>
        )}
        </div>
      </Card>
      <ConfirmDialog
        open={pendingDeletePaymentId !== null}
        title="Delete Payment"
        message="Delete this payment record? This action cannot be undone."
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingDeletePaymentId(null)}
        onConfirm={async () => {
          if (!pendingDeletePaymentId) return;
          await handleDeletePayment(pendingDeletePaymentId);
          setPendingDeletePaymentId(null);
        }}
      />
      <ConfirmDialog
        open={pendingDeleteManualChargeId !== null}
        title="Delete Manual Charge"
        message="Delete this manual charge? This action will also remove its linked expense entry."
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingDeleteManualChargeId(null)}
        onConfirm={async () => {
          if (!pendingDeleteManualChargeId) return;
          await handleDeleteManualCharge(pendingDeleteManualChargeId);
          setPendingDeleteManualChargeId(null);
        }}
      />
    </div>
  );
};
