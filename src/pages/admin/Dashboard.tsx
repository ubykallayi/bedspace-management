import { useCallback, useEffect, useMemo, useState } from 'react';
import { addDays, format, lastDayOfMonth, startOfMonth } from 'date-fns';
import { BedDouble, CheckCircle2, DoorOpen, Download, XCircle } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { MobileActionMenu } from '../../components/ui/MobileActionMenu';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import {
  downloadCsv,
  formatCurrency,
  getMonthInputValue,
  getRentDueForBillingMonth,
  getMonthlyPaymentStatus,
  getPaymentStatusBadgeClass,
  getPaymentStatusLabel,
  isMissingColumnError,
  isMissingTableError,
  calculatePreviousBalance,
} from '../../lib/admin';
import { getCachedAdminData, setCachedAdminData } from '../../lib/adminDataCache';
import { supabase, withSupabaseTimeout } from '../../lib/supabase';

type RoomRecord = {
  id: string;
  name: string;
};

type BedRecord = {
  id: string;
  status: 'vacant' | 'occupied';
  bed_number: string;
  room_id: string;
  property_id?: string;
};

type PaymentRecord = {
  tenant_id: string;
  amount: number | string;
  status: 'paid' | 'pending';
  billing_month: string;
  is_balance_waived?: boolean;
};

type ChargeRecord = {
  tenant_id: string;
  amount: number | string;
  billing_month: string;
};

type TenantSummary = {
  id: string;
  name: string;
  email?: string;
  photo_url?: string | null;
  bed_id: string;
  rent_amount: number | string;
  prorated_rent?: number | string | null;
  start_date: string;
  end_date: string | null;
  property_id?: string;
  room?: RoomRecord | null;
  bed?: BedRecord | null;
};

type OccupancyRow = {
  roomName: string;
  bedNumber: string;
  bedStatus: string;
  currentTenant: string;
  advanceBooking: string;
};
const DASHBOARD_CACHE_KEY = 'admin-dashboard';

export const Dashboard = () => {
  const { selectedProperty, selectedPropertyId, isLoading: propertiesLoading, error: propertiesError } = useAdminProperty();
  const [monthFilter, setMonthFilter] = useState(getMonthInputValue(new Date()));
  const [stats, setStats] = useState({
    rooms: 0,
    totalBeds: 0,
    occupiedBeds: 0,
    vacantBeds: 0,
    monthlyRevenue: 0,
    monthlyExpenses: 0,
    monthlyNetProfit: 0,
    monthlyRemaining: 0,
    monthlyExpected: 0,
    unpaidCount: 0,
    partialCount: 0,
  });
  const [unpaidTenants, setUnpaidTenants] = useState<Array<{
    id: string;
    name: string;
    email?: string;
    photo_url?: string | null;
    roomName?: string;
    bedNumber?: string;
    due: number;
    paid: number;
    remaining: number;
    status: 'paid' | 'partial' | 'unpaid';
  }>>([]);
  const [occupancyRows, setOccupancyRows] = useState<OccupancyRow[]>([]);
  const [expiringTenants, setExpiringTenants] = useState<Array<{
    id: string;
    name: string;
    roomName?: string;
    bedNumber?: string;
    daysToExpiry: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const selectedMonthStart = useMemo(() => startOfMonth(new Date(`${monthFilter}-01`)), [monthFilter]);
  const selectedMonthEnd = useMemo(() => lastDayOfMonth(selectedMonthStart), [selectedMonthStart]);
  const selectedBillingMonth = useMemo(() => format(selectedMonthStart, 'yyyy-MM-dd'), [selectedMonthStart]);
  const selectedMonthLabel = useMemo(() => format(selectedMonthStart, 'MMMM yyyy'), [selectedMonthStart]);

  const fetchStats = useCallback(async () => {
    if (!selectedPropertyId) {
      setStats({
        rooms: 0,
        totalBeds: 0,
        occupiedBeds: 0,
        vacantBeds: 0,
        monthlyRevenue: 0,
        monthlyExpenses: 0,
        monthlyNetProfit: 0,
        monthlyRemaining: 0,
        monthlyExpected: 0,
        unpaidCount: 0,
        partialCount: 0,
      });
      setUnpaidTenants([]);
      setExpiringTenants([]);
      setOccupancyRows([]);
      setLoading(false);
      return;
    }

    const cacheKey = `${DASHBOARD_CACHE_KEY}:${selectedPropertyId}:${selectedBillingMonth}`;
    const cached = getCachedAdminData<{
      stats: typeof stats;
      unpaidTenants: typeof unpaidTenants;
      expiringTenants: typeof expiringTenants;
      occupancyRows: OccupancyRow[];
    }>(cacheKey);

    if (cached) {
      setStats(cached.stats);
      setUnpaidTenants(cached.unpaidTenants);
      setExpiringTenants(cached.expiringTenants);
      setOccupancyRows(cached.occupancyRows);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setFetchError('');

    try {
      const currentMonthStart = selectedMonthStart;
      const currentMonthEnd = selectedMonthEnd;
      const billingMonth = selectedBillingMonth;
      const occupancyReferenceDate = format(currentMonthEnd, 'yyyy-MM-dd');

      const [
        { count: roomsCount, error: roomsCountError },
        { data: beds, error: bedsError },
        { data: expenses, error: expensesError },
        { data: roomRows, error: roomRowsError },
      ] = await withSupabaseTimeout(
        Promise.all([
          supabase.from('rooms').select('*', { count: 'exact', head: true }).eq('property_id', selectedPropertyId),
          supabase.from('beds').select('id, status, bed_number, room_id, property_id').eq('property_id', selectedPropertyId),
          supabase.from('expenses').select('amount, expense_date'),
          supabase.from('rooms').select('id, name').eq('property_id', selectedPropertyId),
        ]),
        'Dashboard data took too long to load. Please try again.',
      );

      const enhancedTenantsResult = await withSupabaseTimeout(
        supabase
          .from('tenants')
          .select('id, name, email, photo_url, bed_id, rent_amount, prorated_rent, start_date, end_date, property_id')
          .eq('property_id', selectedPropertyId),
        'Tenant bookings took too long to load. Please try again.',
      );

      if (roomsCountError) throw roomsCountError;
      if (bedsError) throw bedsError;
      if (expensesError && !isMissingTableError(expensesError)) throw expensesError;
      if (roomRowsError) throw roomRowsError;

      let tenants: TenantSummary[] | null = null;
      if (enhancedTenantsResult.error) {
        if (isMissingColumnError(enhancedTenantsResult.error)) {
          const fallbackTenantsResult = await withSupabaseTimeout(
            supabase
              .from('tenants')
              .select('id, name, email, photo_url, bed_id, rent_amount, start_date, end_date, property_id')
              .eq('property_id', selectedPropertyId),
            'Tenant bookings took too long to load. Please try again.',
          );

          if (fallbackTenantsResult.error) throw fallbackTenantsResult.error;
          tenants = (fallbackTenantsResult.data ?? []) as TenantSummary[];
        } else {
          throw enhancedTenantsResult.error;
        }
      } else {
        tenants = (enhancedTenantsResult.data ?? []) as TenantSummary[];
      }

      const safeBeds = (beds ?? []) as BedRecord[];
      const safeRooms = (roomRows ?? []) as RoomRecord[];
      const safeExpenses = (expenses ?? []) as Array<{ amount: number | string; expense_date: string }>;
      const safeTenants = ((tenants ?? []) as TenantSummary[]).map((tenant) => {
        const bed = safeBeds.find((item) => item.id === tenant.bed_id) ?? null;
        const room = bed ? safeRooms.find((item) => item.id === bed.room_id) ?? null : null;
        return { ...tenant, bed, room };
      });

      const occupied = safeBeds.filter((bed) => safeTenants.some((tenant) => (
        tenant.bed_id === bed.id &&
        tenant.start_date <= occupancyReferenceDate &&
        (!tenant.end_date || tenant.end_date >= occupancyReferenceDate)
      ))).length;
      const totalBeds = safeBeds.length;
      const tenantIds = safeTenants.map((tenant) => tenant.id);
      const paymentsResult = tenantIds.length > 0
        ? await withSupabaseTimeout(
          supabase.from('payments').select('tenant_id, amount, status, billing_month, is_balance_waived').in('tenant_id', tenantIds),
          'Payments took too long to load. Please try again.',
        )
        : { data: [] as PaymentRecord[], error: null };

      if (paymentsResult.error) throw paymentsResult.error;

      const safePayments = (paymentsResult.data ?? []) as PaymentRecord[];
      const currentMonthTenants = safeTenants.filter((tenant) => (
        tenant.start_date <= format(currentMonthEnd, 'yyyy-MM-dd') &&
        (!tenant.end_date || tenant.end_date >= format(currentMonthStart, 'yyyy-MM-dd'))
      ));

      const paymentsForMonth = safePayments.filter((payment) => payment.status === 'paid' && payment.billing_month === billingMonth);
      const paidTotals = new Map<string, number>();
      const waivedSet = new Set<string>();
      paymentsForMonth.forEach((payment) => {
        paidTotals.set(payment.tenant_id, (paidTotals.get(payment.tenant_id) ?? 0) + Number(payment.amount));
        if (payment.is_balance_waived) waivedSet.add(payment.tenant_id);
      });

      const chargesResult = tenantIds.length > 0
        ? await withSupabaseTimeout(
          supabase.from('tenant_charges').select('tenant_id, amount, billing_month').in('tenant_id', tenantIds),
          'Extra charges took too long to load. Please try again.',
        )
        : { data: [] as ChargeRecord[], error: null };
      const chargeTotals = new Map<string, number>();
      (chargesResult.data ?? [])
        .filter((c) => c.billing_month === billingMonth)
        .forEach((charge) => {
          chargeTotals.set(charge.tenant_id, (chargeTotals.get(charge.tenant_id) ?? 0) + Number(charge.amount));
        });

      const unpaid = currentMonthTenants.map((tenant) => {
        const paid = paidTotals.get(tenant.id) ?? 0;
        const extraCharges = chargeTotals.get(tenant.id) ?? 0;
        const baseDue = getRentDueForBillingMonth({
          rentAmount: Number(tenant.rent_amount),
          proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
          startDate: tenant.start_date,
          billingMonth,
        });
        const previousBalance = calculatePreviousBalance(tenant, billingMonth, safePayments, chargesResult.data ?? []);
        const due = baseDue + extraCharges + previousBalance;
        const isWaived = waivedSet.has(tenant.id);
        const remaining = isWaived ? 0 : Math.max(due - paid, 0);
        const status = getMonthlyPaymentStatus(due, paid, isWaived);

        return {
          id: tenant.id,
          name: tenant.name,
          email: tenant.email,
          photo_url: tenant.photo_url ?? null,
          roomName: tenant.room?.name,
          bedNumber: tenant.bed?.bed_number,
          due,
          paid,
          remaining,
          status,
        };
      }).filter((tenant) => tenant.remaining > 0);

      const occupancy = safeBeds.map((bed) => {
        const room = safeRooms.find((item) => item.id === bed.room_id);
        const currentTenant = safeTenants.find((tenant) => (
          tenant.bed_id === bed.id &&
          tenant.start_date <= occupancyReferenceDate &&
          (!tenant.end_date || tenant.end_date >= occupancyReferenceDate)
        ));
        const advanceBooking = safeTenants
          .filter((tenant) => tenant.bed_id === bed.id && tenant.start_date > occupancyReferenceDate)
          .sort((left, right) => left.start_date.localeCompare(right.start_date))[0];

        return {
          roomName: room?.name ?? 'Unknown room',
          bedNumber: bed.bed_number,
          bedStatus: currentTenant ? 'occupied' : 'vacant',
          currentTenant: currentTenant?.name ?? 'Vacant',
          advanceBooking: advanceBooking ? `${advanceBooking.name} (${format(new Date(advanceBooking.start_date), 'MMM dd, yyyy')})` : 'None',
        };
      });

      const revenue = paymentsForMonth.reduce((sum, payment) => sum + Number(payment.amount), 0);
      const expiring = safeTenants
        .filter((tenant) => (
          tenant.end_date &&
          tenant.end_date >= billingMonth &&
          tenant.end_date <= format(addDays(currentMonthEnd, 7), 'yyyy-MM-dd')
        ))
        .map((tenant) => ({
          id: tenant.id,
          name: tenant.name,
          roomName: tenant.room?.name,
          bedNumber: tenant.bed?.bed_number,
          daysToExpiry: Math.max(0, Math.ceil((new Date(tenant.end_date as string).getTime() - currentMonthEnd.getTime()) / (1000 * 60 * 60 * 24))),
        }));
      const monthlyExpenses = safeExpenses
        .filter((expense) => expense.expense_date >= billingMonth && expense.expense_date <= format(currentMonthEnd, 'yyyy-MM-dd'))
        .reduce((sum, expense) => sum + Number(expense.amount), 0);
      const monthlyNetProfit = revenue - monthlyExpenses;
      const expected = currentMonthTenants.reduce((sum, tenant) => {
        const extraCharges = chargeTotals.get(tenant.id) ?? 0;
        return sum + getRentDueForBillingMonth({
          rentAmount: Number(tenant.rent_amount),
          proratedRent: tenant.prorated_rent != null ? Number(tenant.prorated_rent) : null,
          startDate: tenant.start_date,
          billingMonth,
        }) + extraCharges;
      }, 0);
      const remaining = unpaid.reduce((sum, tenant) => sum + tenant.remaining, 0);

      setStats({
        rooms: roomsCount || 0,
        totalBeds,
        occupiedBeds: occupied,
        vacantBeds: totalBeds - occupied,
        monthlyRevenue: revenue,
        monthlyExpenses,
        monthlyNetProfit,
        monthlyRemaining: remaining,
        monthlyExpected: expected,
        unpaidCount: unpaid.filter((tenant) => tenant.status === 'unpaid').length,
        partialCount: unpaid.filter((tenant) => tenant.status === 'partial').length,
      });
      setUnpaidTenants(unpaid);
      setExpiringTenants(expiring);
      setOccupancyRows(occupancy);
      setCachedAdminData(cacheKey, {
        stats: {
          rooms: roomsCount || 0,
          totalBeds,
          occupiedBeds: occupied,
          vacantBeds: totalBeds - occupied,
          monthlyRevenue: revenue,
          monthlyExpenses,
          monthlyNetProfit,
          monthlyRemaining: remaining,
          monthlyExpected: expected,
          unpaidCount: unpaid.filter((tenant) => tenant.status === 'unpaid').length,
          partialCount: unpaid.filter((tenant) => tenant.status === 'partial').length,
        },
        unpaidTenants: unpaid,
        expiringTenants: expiring,
        occupancyRows: occupancy,
      });
    } catch (error) {
      console.error('Error fetching stats:', error);
      setFetchError(error instanceof Error ? error.message : 'Unable to load dashboard data.');
    } finally {
      setLoading(false);
    }
  }, [selectedBillingMonth, selectedMonthEnd, selectedMonthStart, selectedPropertyId]);

  useEffect(() => {
    void fetchStats();
  }, [fetchStats]);

  const exportCollectionsCsv = () => {
    downloadCsv(
      `collections-summary-${monthFilter}.csv`,
      ['Section', 'Label', 'Value'],
      [
        ['Summary', `Revenue For ${selectedMonthLabel}`, stats.monthlyRevenue],
        ['Summary', `Expenses For ${selectedMonthLabel}`, stats.monthlyExpenses],
        ['Summary', `Net Profit For ${selectedMonthLabel}`, stats.monthlyNetProfit],
        ['Summary', `Expected For ${selectedMonthLabel}`, stats.monthlyExpected],
        ['Summary', `Remaining For ${selectedMonthLabel}`, stats.monthlyRemaining],
        ['Summary', 'Unpaid Tenants', stats.unpaidCount],
        ['Summary', 'Partial Tenants', stats.partialCount],
      ],
    );
  };

  const exportUnpaidCsv = () => {
    downloadCsv(
      `unpaid-tenants-${monthFilter}.csv`,
      ['Tenant', 'Email', 'Room', 'Bed', 'Billing Month', 'Due', 'Paid', 'Remaining', 'Status'],
      unpaidTenants.map((tenant) => [
        tenant.name,
        tenant.email ?? '',
        tenant.roomName ?? 'Unknown room',
        tenant.bedNumber ?? 'Unknown bed',
        selectedMonthLabel,
        tenant.due,
        tenant.paid,
        tenant.remaining,
        getPaymentStatusLabel(tenant.status),
      ]),
    );
  };

  const exportOccupancyCsv = () => {
    downloadCsv(
      `occupancy-${monthFilter}.csv`,
      ['Room', 'Bed', 'Bed Status', 'Current Tenant', 'Advance Booking'],
      occupancyRows.map((row) => [
        row.roomName,
        row.bedNumber,
        row.bedStatus,
        row.currentTenant,
        row.advanceBooking,
      ]),
    );
  };

  if (loading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading dashboard...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are calculating occupancy and this month&apos;s collections now.</p>
        </Card>
      </div>
    );
  }

  if (propertiesLoading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading properties...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are loading your property list before preparing the dashboard.</p>
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
            {propertiesError || 'Create your first property in Settings to start organizing rooms, beds, and tenants.'}
          </p>
        </Card>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="page-container">
        <Card style={{ borderColor: 'rgba(239, 68, 68, 0.35)' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Unable to load the dashboard</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>{fetchError}</p>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
            This points to a real data, schema, or permission problem rather than an empty month.
          </p>
          <Button onClick={() => void fetchStats()}>Retry</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Overview</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Monthly occupancy, collections, and follow-up items for {selectedProperty?.name ?? 'the selected property'} in {selectedMonthLabel}.
          </p>
        </div>
        <div className="admin-toolbar">
          <div className="toolbar-month-field">
            <Input
              type="month"
              value={monthFilter}
              aria-label="Dashboard month"
              title="Dashboard month"
              onChange={(e) => setMonthFilter(e.target.value)}
            />
          </div>
          <Button className="desktop-only" variant="secondary" onClick={exportCollectionsCsv}>
            <Download size={16} /> Collections CSV
          </Button>
          <Button className="desktop-only" variant="secondary" onClick={exportUnpaidCsv}>
            <Download size={16} /> Unpaid CSV
          </Button>
          <Button className="desktop-only" variant="secondary" onClick={exportOccupancyCsv}>
            <Download size={16} /> Occupancy CSV
          </Button>
          <MobileActionMenu
            items={[
              { label: 'Collections CSV', onClick: exportCollectionsCsv },
              { label: 'Unpaid CSV', onClick: exportUnpaidCsv },
              { label: 'Occupancy CSV', onClick: exportOccupancyCsv },
            ]}
          />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <Card style={{ borderLeft: '4px solid var(--primary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Total Rooms</p>
              <h2 style={{ fontSize: '2rem', marginTop: '0.5rem' }}>{stats.rooms}</h2>
            </div>
            <div style={{ padding: '1rem', background: 'var(--primary-glow)', borderRadius: '50%' }}>
              <DoorOpen size={24} color="var(--primary)" />
            </div>
          </div>
        </Card>

        <Card style={{ borderLeft: '4px solid var(--secondary)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Total Beds</p>
              <h2 style={{ fontSize: '2rem', marginTop: '0.5rem' }}>{stats.totalBeds}</h2>
            </div>
            <div style={{ padding: '1rem', background: 'rgba(14, 165, 233, 0.1)', borderRadius: '50%' }}>
              <BedDouble size={24} color="var(--secondary)" />
            </div>
          </div>
        </Card>

        <Card style={{ borderLeft: '4px solid var(--success)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Occupied Beds</p>
              <h2 style={{ fontSize: '2rem', marginTop: '0.5rem' }}>{stats.occupiedBeds}</h2>
            </div>
            <div style={{ padding: '1rem', background: 'var(--success-bg)', borderRadius: '50%' }}>
              <CheckCircle2 size={24} color="var(--success)" />
            </div>
          </div>
        </Card>

        <Card style={{ borderLeft: '4px solid var(--warning)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Vacant Beds</p>
              <h2 style={{ fontSize: '2rem', marginTop: '0.5rem' }}>{stats.vacantBeds}</h2>
            </div>
            <div style={{ padding: '1rem', background: 'var(--warning-bg)', borderRadius: '50%' }}>
              <XCircle size={24} color="var(--warning)" />
            </div>
          </div>
        </Card>

        <Card style={{ borderLeft: '4px solid #8b5cf6', gridColumn: '1 / -1' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', alignItems: 'center' }}>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Revenue</p>
              <h2 style={{ fontSize: '2.25rem', marginTop: '0.5rem', color: '#8b5cf6' }}>{formatCurrency(stats.monthlyRevenue)}</h2>
            </div>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Expected</p>
              <h2 style={{ fontSize: '2.25rem', marginTop: '0.5rem' }}>{formatCurrency(stats.monthlyExpected)}</h2>
            </div>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Expenses</p>
              <h2 style={{ fontSize: '2.25rem', marginTop: '0.5rem', color: 'var(--danger)' }}>{formatCurrency(stats.monthlyExpenses)}</h2>
            </div>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Net Profit</p>
              <h2 style={{ fontSize: '2.25rem', marginTop: '0.5rem', color: stats.monthlyNetProfit >= 0 ? 'var(--success)' : 'var(--danger)' }}>
                {formatCurrency(stats.monthlyNetProfit)}
              </h2>
            </div>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Remaining</p>
              <h2 style={{ fontSize: '2.25rem', marginTop: '0.5rem', color: 'var(--warning)' }}>{formatCurrency(stats.monthlyRemaining)}</h2>
            </div>
            <div>
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Unpaid / Partial</p>
              <h2 style={{ fontSize: '2.25rem', marginTop: '0.5rem' }}>{stats.unpaidCount} / {stats.partialCount}</h2>
            </div>
          </div>
        </Card>
      </div>

      {(unpaidTenants.length > 0 || expiringTenants.length > 0) && (
        <Card style={{ marginBottom: '1rem', borderColor: 'rgba(245, 158, 11, 0.35)', padding: '0.9rem 1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div style={{ color: 'var(--text-secondary)' }}>
              {unpaidTenants.length > 0 ? `${unpaidTenants.length} unpaid or partial in ${selectedMonthLabel}. ` : ''}
              {expiringTenants.length > 0 ? `${expiringTenants.length} ending by ${format(addDays(selectedMonthEnd, 7), 'MMM dd, yyyy')}.` : ''}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {unpaidTenants.length > 0 ? <span className="badge badge-danger">{unpaidTenants.length} Unpaid</span> : null}
              {expiringTenants.length > 0 ? <span className="badge badge-warning">{expiringTenants.length} Expiring</span> : null}
            </div>
          </div>
        </Card>
      )}

      <Card>
        <h2 style={{ marginBottom: '1rem' }}>Unpaid For {selectedMonthLabel}</h2>
        {unpaidTenants.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '1rem 0', color: 'var(--text-secondary)' }}>
            Everyone active in {selectedMonthLabel} is fully paid.
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {unpaidTenants.map((tenant) => (
              <div key={tenant.id} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '1rem', padding: '0.9rem 0', borderBottom: '1px solid rgba(255,255,255,0.06)', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
                  {tenant.photo_url ? (
                    <img src={tenant.photo_url} alt={tenant.name} style={{ width: '24px', height: '24px', borderRadius: '999px', objectFit: 'cover' }} />
                  ) : null}
                  <div>
                  <div style={{ fontWeight: 600 }}>{tenant.name}</div>
                  <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{tenant.email ?? 'No email saved'}</div>
                  </div>
                </div>
                <div style={{ color: 'var(--text-secondary)' }}>{tenant.roomName} | Bed {tenant.bedNumber}</div>
                <div>Due {formatCurrency(tenant.due)}</div>
                <div>Paid {formatCurrency(tenant.paid)}</div>
                <div style={{ color: 'var(--warning)' }}>Remaining {formatCurrency(tenant.remaining)}</div>
                <div style={{ justifySelf: 'end' }}>
                  <span className={`badge ${getPaymentStatusBadgeClass(tenant.status)}`}>
                    {getPaymentStatusLabel(tenant.status)}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
};
