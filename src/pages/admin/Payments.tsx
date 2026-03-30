import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format, lastDayOfMonth, startOfMonth } from 'date-fns';
import { CheckCircle2, Download, MessageCircle, Pencil, ReceiptText, Search, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  downloadCsv,
  formatCurrency,
  getMonthInputValue,
  getMonthStartKey,
  getRentDueForBillingMonth,
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
import { supabase } from '../../lib/supabase';

type RoomRecord = {
  id: string;
  name: string;
};

type BedRecord = {
  id: string;
  bed_number: string;
  room_id: string;
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
  updated_at?: string | null;
  updated_by?: string | null;
  tenant?: TenantSummary | null;
  cycleDue?: number;
  cyclePaid?: number;
  cycleStatus?: 'paid' | 'partial' | 'unpaid';
};

const getCurrentBillingMonth = () => getMonthStartKey(new Date());

const BASE_PAYMENT_SELECT = 'id, tenant_id, amount, payment_date, billing_month, status';
const ENHANCED_PAYMENT_SELECT = `${BASE_PAYMENT_SELECT}, updated_at, updated_by`;
const ENHANCED_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, prorated_rent, start_date, end_date, is_active';
const BASE_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, prorated_rent, start_date, end_date';
const LEGACY_ENHANCED_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, start_date, end_date, is_active';
const LEGACY_TENANT_SELECT = 'id, name, email, phone, bed_id, rent_amount, start_date, end_date';
const PAYMENTS_CACHE_KEY = 'payments-page';

export const Payments = () => {
  const { settings } = useAppSettings();
  const { user } = useAuth();
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [tenants, setTenants] = useState<TenantSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [paymentSchemaSupportsAudit, setPaymentSchemaSupportsAudit] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [monthFilter, setMonthFilter] = useState(getMonthInputValue(new Date()));
  const [cycleStatusFilter, setCycleStatusFilter] = useState('all');
  const [tenantFilter, setTenantFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const formCardRef = useRef<HTMLDivElement | null>(null);

  const [formData, setFormData] = useState({
    tenant_id: '',
    amount: '',
    payment_date: new Date().toISOString().split('T')[0],
    billing_month: getCurrentBillingMonth(),
    status: 'paid' as 'paid' | 'pending',
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
    const cached = getCachedAdminData<{
      payments: PaymentRecord[];
      tenants: TenantSummary[];
      paymentSchemaSupportsAudit: boolean;
    }>(PAYMENTS_CACHE_KEY);

    if (cached) {
      setPayments(cached.payments);
      setTenants(cached.tenants);
      setPaymentSchemaSupportsAudit(cached.paymentSchemaSupportsAudit);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setFetchError('');

    let paymentRows: PaymentRecord[] = [];
    let paymentAuditEnabled = true;

    const enhancedPayments = await supabase
      .from('payments')
      .select(ENHANCED_PAYMENT_SELECT)
      .order('payment_date', { ascending: false });

    if (enhancedPayments.error) {
      if (isMissingColumnError(enhancedPayments.error)) {
        paymentAuditEnabled = false;
        const fallbackPayments = await supabase
          .from('payments')
          .select(BASE_PAYMENT_SELECT)
          .order('payment_date', { ascending: false });

        if (fallbackPayments.error) {
          console.error('Payment fetch error:', fallbackPayments.error);
          setFetchError(fallbackPayments.error.message || 'Unable to load payment records.');
        } else {
          paymentRows = (fallbackPayments.data ?? []) as PaymentRecord[];
        }
      } else {
        console.error('Payment fetch error:', enhancedPayments.error);
        setFetchError(enhancedPayments.error.message || 'Unable to load payment records.');
      }
    } else {
      paymentRows = (enhancedPayments.data ?? []) as PaymentRecord[];
    }

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
      const tenantResult = await supabase
        .from('tenants')
        .select(tenantSelect)
        .order('start_date', { ascending: false });

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
    ] = await Promise.all([
      supabase.from('beds').select('id, bed_number, room_id'),
      supabase.from('rooms').select('id, name'),
    ]);

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

    const paidTotals = new Map<string, number>();
    paymentRows.forEach((payment) => {
      if (payment.status !== 'paid') return;
      const key = `${payment.tenant_id}:${payment.billing_month}`;
      paidTotals.set(key, (paidTotals.get(key) ?? 0) + Number(payment.amount));
    });

    const enhancedPaymentsWithStatus = paymentRows.map((payment) => {
      const tenant = enhancedTenants.find((item) => item.id === payment.tenant_id) ?? null;
      const cycleDue = tenant
        ? getRentDueForBillingMonth({
          rentAmount: Number(tenant.rent_amount ?? 0),
          proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
          startDate: tenant.start_date,
          billingMonth: payment.billing_month,
        })
        : 0;
      const cyclePaid = paidTotals.get(`${payment.tenant_id}:${payment.billing_month}`) ?? 0;
      const cycleStatus = getMonthlyPaymentStatus(cycleDue, cyclePaid);

      return {
        ...payment,
        tenant,
        cycleDue,
        cyclePaid,
        cycleStatus,
      };
    });

    setPaymentSchemaSupportsAudit(paymentAuditEnabled);
    setTenants(enhancedTenants);
    setPayments(enhancedPaymentsWithStatus);
    setCachedAdminData(PAYMENTS_CACHE_KEY, {
      payments: enhancedPaymentsWithStatus,
      tenants: enhancedTenants,
      paymentSchemaSupportsAudit: paymentAuditEnabled,
    });
    setLoading(false);
  }, []);

  const buildReceiptData = useCallback((payment: {
    id: string;
    amount: number;
    billing_month: string;
    payment_date: string;
    status: 'paid' | 'pending';
    tenant: TenantSummary | null;
  }): PaymentReceiptData => {
    const tenant = payment.tenant;
    const cyclePaid = payments
      .filter((item) => item.status === 'paid' && item.tenant_id === tenant?.id && item.billing_month === payment.billing_month)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const updatedCyclePaid = payment.status === 'paid'
      ? Math.max(cyclePaid, payment.amount)
      : cyclePaid;
    const dueAmount = tenant
      ? getRentDueForBillingMonth({
        rentAmount: Number(tenant.rent_amount ?? 0),
        proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
        startDate: tenant.start_date,
        billingMonth: payment.billing_month,
      })
      : 0;
    const remainingAmount = Math.max(dueAmount - updatedCyclePaid, 0);

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
      paymentStatus: payment.status === 'paid' ? (remainingAmount > 0 ? 'Partial' : 'Paid') : 'Pending',
    };
  }, [payments, settings]);

  const openWhatsappShare = (receipt: PaymentReceiptData) => {
    window.open(getWhatsappShareLink(receipt), '_blank', 'noopener,noreferrer');
  };

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRecordPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!formData.tenant_id) {
      setFormError('Please select a tenant.');
      return;
    }

    const parsedAmount = Number(formData.amount);
    if (Number.isNaN(parsedAmount) || parsedAmount <= 0) {
      setFormError('Please enter a valid payment amount.');
      return;
    }

    const paymentPayload: Record<string, string | number | null> = {
      tenant_id: formData.tenant_id,
      amount: parsedAmount,
      payment_date: formData.payment_date,
      billing_month: formData.billing_month,
      status: formData.status,
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
      setFormError(error.message || 'Unable to save payment record.');
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
    });
  };

  const handleTenantSelect = (id: string) => {
    const tenant = tenants.find((item) => item.id === id);
    setFormData({
      ...formData,
      tenant_id: id,
      amount: tenant
        ? String(getRentDueForBillingMonth({
          rentAmount: Number(tenant.rent_amount),
          proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
          startDate: tenant.start_date,
          billingMonth: formData.billing_month,
        }))
        : '',
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
    });
    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleDeletePayment = async (paymentId: string) => {
    if (!confirm('Delete this payment record?')) return;

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
      });
    }

    await fetchData();
  };

  const selectedMonthStart = useMemo(() => startOfMonth(new Date(`${monthFilter}-01`)), [monthFilter]);
  const selectedMonthEnd = useMemo(() => lastDayOfMonth(selectedMonthStart), [selectedMonthStart]);
  const selectedBillingMonth = useMemo(() => format(selectedMonthStart, 'yyyy-MM-dd'), [selectedMonthStart]);

  const activeTenantsForMonth = useMemo(() => (
    tenants.filter((tenant) => (
      tenant.is_active !== false &&
      tenant.start_date <= format(selectedMonthEnd, 'yyyy-MM-dd') &&
      (!tenant.end_date || tenant.end_date >= format(selectedMonthStart, 'yyyy-MM-dd'))
    ))
  ), [selectedMonthEnd, selectedMonthStart, tenants]);

  const paymentTotalsForMonth = useMemo(() => {
    const totals = new Map<string, number>();
    payments
      .filter((payment) => payment.status === 'paid' && payment.billing_month === selectedBillingMonth)
      .forEach((payment) => {
        totals.set(payment.tenant_id, (totals.get(payment.tenant_id) ?? 0) + Number(payment.amount));
      });
    return totals;
  }, [payments, selectedBillingMonth]);

  const monthlyTenantStatuses = useMemo(() => {
    return activeTenantsForMonth.map((tenant) => {
      const due = getRentDueForBillingMonth({
        rentAmount: Number(tenant.rent_amount),
        proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
        startDate: tenant.start_date,
        billingMonth: selectedBillingMonth,
      });
      const paid = paymentTotalsForMonth.get(tenant.id) ?? 0;
      const remaining = Math.max(due - paid, 0);
      const cycleStatus = getMonthlyPaymentStatus(due, paid);

      return {
        ...tenant,
        due,
        paid,
        remaining,
        cycleStatus,
      };
    });
  }, [activeTenantsForMonth, paymentTotalsForMonth, selectedBillingMonth]);

  const filteredPayments = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return payments.filter((payment) => {
      const matchesSearch = normalizedSearch.length === 0 || [
        payment.tenant?.name ?? '',
        payment.tenant?.email ?? '',
        payment.tenant?.room?.name ?? '',
        payment.tenant?.bed?.bed_number ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesMonth = payment.billing_month === selectedBillingMonth;
      const matchesCycleStatus = cycleStatusFilter === 'all' || payment.cycleStatus === cycleStatusFilter;
      const matchesTenant = tenantFilter === 'all' || payment.tenant_id === tenantFilter;

      return matchesSearch && matchesMonth && matchesCycleStatus && matchesTenant;
    });
  }, [cycleStatusFilter, payments, searchQuery, selectedBillingMonth, tenantFilter]);

  const selectedTenant = tenants.find((tenant) => tenant.id === formData.tenant_id) ?? null;
  const collectedThisMonth = monthlyTenantStatuses.reduce((sum, tenant) => sum + tenant.paid, 0);
  const expectedThisMonth = monthlyTenantStatuses.reduce((sum, tenant) => sum + tenant.due, 0);
  const remainingThisMonth = monthlyTenantStatuses.reduce((sum, tenant) => sum + tenant.remaining, 0);
  const unpaidTenantCount = monthlyTenantStatuses.filter((tenant) => tenant.cycleStatus === 'unpaid').length;
  const partialTenantCount = monthlyTenantStatuses.filter((tenant) => tenant.cycleStatus === 'partial').length;

  const exportPaymentsCsv = () => {
    downloadCsv(
      `payments-${selectedBillingMonth}.csv`,
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
    const rows = monthlyTenantStatuses
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
      `unpaid-tenants-${selectedBillingMonth}.csv`,
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
          <p style={{ color: 'var(--text-secondary)' }}>Track collections, see who is unpaid this month, and export reports for finance follow-up.</p>
        </div>
        <div className="admin-toolbar">
          <Button variant="secondary" onClick={() => setShowFilters((value) => !value)}>
            <Search size={16} /> {showFilters ? 'Hide Search' : 'Search & Filter'}
          </Button>
          <Button variant="secondary" onClick={exportPaymentsCsv}>
            <Download size={16} /> Export Payments
          </Button>
          <Button variant="secondary" onClick={exportUnpaidCsv}>
            <Download size={16} /> Export Unpaid
          </Button>
          <Button onClick={() => setShowForm(!showForm)}>
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

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Collected</div>
          <h2 style={{ marginTop: '0.5rem' }}>{formatCurrency(collectedThisMonth)}</h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Expected</div>
          <h2 style={{ marginTop: '0.5rem' }}>{formatCurrency(expectedThisMonth)}</h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Remaining</div>
          <h2 style={{ marginTop: '0.5rem', color: 'var(--warning)' }}>{formatCurrency(remainingThisMonth)}</h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Unpaid / Partial</div>
          <h2 style={{ marginTop: '0.5rem' }}>{unpaidTenantCount} / {partialTenantCount}</h2>
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
            setMonthFilter(getMonthInputValue(new Date()));
            setCycleStatusFilter('all');
            setTenantFilter('all');
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

          <Input
            type="month"
            label="Billing Month"
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
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
              {tenants.map((tenant) => (
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
                {tenants.map((tenant) => (
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
                setFormData({
                  ...formData,
                  billing_month: nextBillingMonth,
                  amount: tenant
                    ? String(getRentDueForBillingMonth({
                      rentAmount: Number(tenant.rent_amount),
                      proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
                      startDate: tenant.start_date,
                      billingMonth: nextBillingMonth,
                    }))
                    : formData.amount,
                });
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

            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button variant="primary" type="submit" style={{ height: '42px', marginBottom: '1rem' }}>
                {editingPaymentId ? 'Update Payment' : 'Save Record'}
              </Button>
            </div>
          </form>

          {selectedTenant && (
            <div style={{ marginTop: '0.75rem', color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
              Selected booking: {selectedTenant.room?.name ?? 'Unknown room'} | Bed {selectedTenant.bed?.bed_number ?? 'Unknown'} | Due for {format(new Date(formData.billing_month), 'MMM yyyy')} {formatCurrency(getRentDueForBillingMonth({
                rentAmount: Number(selectedTenant.rent_amount),
                proratedRent: selectedTenant.prorated_rent != null ? Number(selectedTenant.prorated_rent) : null,
                startDate: selectedTenant.start_date,
                billingMonth: formData.billing_month,
              }))}
            </div>
          )}

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

      <Card style={{ marginBottom: '1.5rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Unpaid Or Partial For {format(new Date(selectedBillingMonth), 'MMMM yyyy')}</h2>
        {monthlyTenantStatuses.filter((tenant) => tenant.remaining > 0).length === 0 ? (
          <div style={{ color: 'var(--text-secondary)', textAlign: 'center', padding: '1rem 0' }}>
            Everyone active for this month is fully paid.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {monthlyTenantStatuses.filter((tenant) => tenant.remaining > 0).map((tenant) => (
              <div key={tenant.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: '1rem', padding: '0.9rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{tenant.name}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{tenant.room?.name} | Bed {tenant.bed?.bed_number}</div>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{tenant.email ?? 'No email saved'}</div>
                <div>{formatCurrency(tenant.due)}</div>
                <div>{formatCurrency(tenant.paid)}</div>
                <div style={{ justifySelf: 'end', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                  <span style={{ color: 'var(--warning)' }}>{formatCurrency(tenant.remaining)}</span>
                  <span className={`badge ${getPaymentStatusBadgeClass(tenant.cycleStatus)}`}>
                    {getPaymentStatusLabel(tenant.cycleStatus)}
                  </span>
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
          <div key={payment.id} style={{ display: 'grid', gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr 1fr auto', padding: '1rem', borderBottom: '1px solid rgba(255,255,255,0.05)', alignItems: 'center', background: editingPaymentId === payment.id ? 'rgba(123, 97, 255, 0.08)' : undefined }}>
            <div>
              <div style={{ fontWeight: 500 }}>{payment.tenant?.name}</div>
              <div style={{ color: 'var(--text-tertiary)', fontSize: '0.8rem' }}>{payment.tenant?.email}</div>
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
              <button onClick={() => void handleDeletePayment(payment.id)} style={{ color: 'var(--danger)', padding: '0.25rem' }}>
                <Trash2 size={16} />
              </button>
            </div>
          </div>
        ))}

        {filteredPayments.length === 0 && payments.length > 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No payment records match the selected month or filters.
          </div>
        )}

        {payments.length === 0 && (
          <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-tertiary)' }}>
            No payments recorded yet. Use Record Payment to add the first transaction.
          </div>
        )}
        </div>
      </Card>
    </div>
  );
};
