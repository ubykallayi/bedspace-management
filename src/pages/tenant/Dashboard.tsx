import { useEffect, useState } from 'react';
import { differenceInDays, format, lastDayOfMonth, startOfMonth } from 'date-fns';
import { DoorOpen, ReceiptText } from 'lucide-react';
import { Card } from '../../components/ui/Card';
import { useAppSettings } from '../../contexts/AppSettingsContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  formatCurrency,
  getBookingLifecycleStatus,
  getBookingStatusBadgeClass,
  getBookingStatusLabel,
  getRentDueForBillingMonth,
  getMonthlyPaymentStatus,
  getPaymentStatusBadgeClass,
  getPaymentStatusLabel,
  isMissingColumnError,
} from '../../lib/admin';
import { openPaymentReceipt } from '../../lib/receipts';
import { supabase } from '../../lib/supabase';

type BedRecord = {
  id: string;
  bed_number: string;
  room_id: string;
};

type RoomRecord = {
  id: string;
  name: string;
};

type TenantBooking = {
  id: string;
  name: string;
  email: string;
  phone?: string;
  user_id: string | null;
  bed_id: string;
  rent_amount: number | string;
  prorated_rent?: number | string | null;
  start_date: string;
  end_date: string | null;
  bed?: BedRecord | null;
  room?: RoomRecord | null;
};

type PaymentRecord = {
  id: string;
  tenant_id: string;
  amount: number | string;
  payment_date: string;
  billing_month: string;
  status: string;
};

type BookingCardData = {
  booking: TenantBooking;
  contractStatusClassName: string;
  contractStatusLabel: string;
  contractStatusDetail: string;
};

const sortBookings = (bookings: TenantBooking[]) => [...bookings].sort((left, right) => {
  if (left.start_date === right.start_date) return left.id.localeCompare(right.id);
  return right.start_date.localeCompare(left.start_date);
});

const getBookingCardData = (booking: TenantBooking, today: Date): BookingCardData => {
  const daysLeft = booking.end_date
    ? differenceInDays(new Date(booking.end_date), today)
    : null;
  const lifecycleStatus = getBookingLifecycleStatus(booking.start_date, booking.end_date, true, today);
  const contractStatusClassName = getBookingStatusBadgeClass(lifecycleStatus);
  const contractStatusLabel = getBookingStatusLabel(lifecycleStatus);
  const contractStatusDetail = lifecycleStatus === 'upcoming'
    ? `Starts ${format(new Date(booking.start_date), 'MMM dd, yyyy')}`
    : lifecycleStatus === 'expired'
      ? 'This booking has ended.'
      : daysLeft === null
        ? 'Ongoing booking'
        : `${daysLeft} days remaining`;

  return {
    booking,
    contractStatusClassName,
    contractStatusLabel,
    contractStatusDetail,
  };
};

const renderBookingSection = (title: string, description: string, bookingCards: BookingCardData[]) => {
  if (bookingCards.length === 0) return null;

  return (
    <div style={{ marginBottom: '2rem' }}>
      <div style={{ marginBottom: '1rem' }}>
        <h2 style={{ marginBottom: '0.35rem' }}>{title}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{description}</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '1.5rem' }}>
        {bookingCards.map(({ booking, contractStatusClassName, contractStatusLabel, contractStatusDetail }) => (
          <Card key={booking.id} style={{ background: 'linear-gradient(135deg, var(--bg-card), var(--primary-glow))', border: '1px solid var(--border-focus)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <h3 style={{ margin: 0 }}>Accommodation</h3>
              <DoorOpen color="var(--primary)" />
            </div>

            <div style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.25rem' }}>
              {booking.room?.name}
            </div>
            <div style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
              Bed Number: <span style={{ color: '#fff' }}>{booking.bed?.bed_number}</span>
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Start Date:</span>
              <span>{format(new Date(booking.start_date), 'MMM dd, yyyy')}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>End Date:</span>
              <span>{booking.end_date ? format(new Date(booking.end_date), 'MMM dd, yyyy') : 'Ongoing'}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Rent:</span>
              <span>{formatCurrency(Number(booking.rent_amount))} / month</span>
            </div>
            <div style={{ marginTop: '1rem', paddingTop: '1rem', borderTop: '1px solid var(--border-light)', display: 'flex', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>Status:</span>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.35rem' }}>
                <span className={`badge ${contractStatusClassName}`}>
                  {contractStatusLabel}
                </span>
                <span style={{ color: 'var(--text-secondary)', fontSize: '0.8rem' }}>{contractStatusDetail}</span>
              </div>
            </div>
          </Card>
        ))}
      </div>
    </div>
  );
};

export const TenantDashboard = () => {
  const { settings } = useAppSettings();
  const { user } = useAuth();
  const [bookings, setBookings] = useState<TenantBooking[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');

  useEffect(() => {
    const fetchTenantData = async () => {
      if (!user) {
        setLoading(false);
        return;
      }

      setLoading(true);
      setFetchError('');

      let bookingRows: TenantBooking[] = [];

      const byUserResult = await supabase
        .from('tenants')
        .select('id, name, email, phone, user_id, bed_id, rent_amount, prorated_rent, start_date, end_date')
        .eq('user_id', user.id)
        .order('start_date', { ascending: false });

      if (byUserResult.error) {
        if (!isMissingColumnError(byUserResult.error)) {
          console.error('Tenant dashboard fetch error:', byUserResult.error);
          setFetchError(byUserResult.error.message || 'Unable to load your bookings right now.');
          setLoading(false);
          return;
        }

        const legacyByUserResult = await supabase
          .from('tenants')
          .select('id, name, email, phone, user_id, bed_id, rent_amount, start_date, end_date')
          .eq('user_id', user.id)
          .order('start_date', { ascending: false });

        if (legacyByUserResult.error) {
          console.error('Tenant dashboard fetch error:', legacyByUserResult.error);
          setFetchError(legacyByUserResult.error.message || 'Unable to load your bookings right now.');
          setLoading(false);
          return;
        }

        bookingRows = (legacyByUserResult.data ?? []) as TenantBooking[];
      } else if (byUserResult.data && byUserResult.data.length > 0) {
        bookingRows = byUserResult.data as TenantBooking[];
      }

      if (bookingRows.length === 0 && user.email) {
        const normalizedEmail = user.email.toLowerCase();
        const emailLookup = await supabase
          .from('tenants')
          .select('id, name, email, phone, user_id, bed_id, rent_amount, prorated_rent, start_date, end_date')
          .eq('email', normalizedEmail)
          .order('start_date', { ascending: false });

        if (emailLookup.error) {
          if (!isMissingColumnError(emailLookup.error)) {
            console.error('Tenant email lookup error:', emailLookup.error);
            setFetchError(emailLookup.error.message || 'Unable to load your bookings right now.');
            setLoading(false);
            return;
          }

          const legacyEmailLookup = await supabase
            .from('tenants')
            .select('id, name, email, phone, user_id, bed_id, rent_amount, start_date, end_date')
            .eq('email', normalizedEmail)
            .order('start_date', { ascending: false });

          if (legacyEmailLookup.error) {
            console.error('Tenant email lookup error:', legacyEmailLookup.error);
            setFetchError(legacyEmailLookup.error.message || 'Unable to load your bookings right now.');
            setLoading(false);
            return;
          }

          if (legacyEmailLookup.data && legacyEmailLookup.data.length > 0) {
            const unlinkedIds = legacyEmailLookup.data
              .filter((booking) => !booking.user_id)
              .map((booking) => booking.id);

            if (unlinkedIds.length > 0) {
              await supabase
                .from('tenants')
                .update({ user_id: user.id })
                .in('id', unlinkedIds)
                .eq('email', normalizedEmail);
            }

            bookingRows = legacyEmailLookup.data.map((booking) => ({
              ...booking,
              user_id: booking.user_id ?? user.id,
            })) as TenantBooking[];
          }
        } else if (emailLookup.data && emailLookup.data.length > 0) {
          const unlinkedIds = emailLookup.data
            .filter((booking) => !booking.user_id)
            .map((booking) => booking.id);

          if (unlinkedIds.length > 0) {
            await supabase
              .from('tenants')
              .update({ user_id: user.id })
              .in('id', unlinkedIds)
              .eq('email', normalizedEmail);
          }

          bookingRows = emailLookup.data.map((booking) => ({
            ...booking,
            user_id: booking.user_id ?? user.id,
          })) as TenantBooking[];
        }
      }

      const bedIds = [...new Set(bookingRows.map((booking) => booking.bed_id))];
      const { data: bedRows, error: bedError } = bedIds.length > 0
        ? await supabase.from('beds').select('id, bed_number, room_id').in('id', bedIds)
        : { data: [] as BedRecord[] };
      if (bedError) {
        console.error('Tenant bed lookup error:', bedError);
        setFetchError(bedError.message || 'Unable to load room details right now.');
        setLoading(false);
        return;
      }
      const roomIds = [...new Set((bedRows ?? []).map((bed) => bed.room_id))];
      const { data: roomRows, error: roomError } = roomIds.length > 0
        ? await supabase.from('rooms').select('id, name').in('id', roomIds)
        : { data: [] as RoomRecord[] };
      if (roomError) {
        console.error('Tenant room lookup error:', roomError);
        setFetchError(roomError.message || 'Unable to load room details right now.');
        setLoading(false);
        return;
      }

      const enrichedBookings = bookingRows.map((booking) => {
        const bed = (bedRows ?? []).find((item) => item.id === booking.bed_id) ?? null;
        const room = bed ? (roomRows ?? []).find((item) => item.id === bed.room_id) ?? null : null;

        return {
          ...booking,
          bed,
          room,
        };
      });

      const sortedBookings = sortBookings(enrichedBookings);
      setBookings(sortedBookings);

      if (sortedBookings.length > 0) {
        const { data: paymentRows, error: paymentError } = await supabase
          .from('payments')
          .select('id, tenant_id, amount, payment_date, billing_month, status')
          .in('tenant_id', sortedBookings.map((booking) => booking.id))
          .order('payment_date', { ascending: false });
        if (paymentError) {
          console.error('Tenant payment lookup error:', paymentError);
          setFetchError(paymentError.message || 'Unable to load payment history right now.');
          setLoading(false);
          return;
        }

        setPayments((paymentRows ?? []) as PaymentRecord[]);
      } else {
        setPayments([]);
      }

      setLoading(false);
    };

    void fetchTenantData();
  }, [user]);

  if (loading) return <div className="page-container">Loading your portal...</div>;

  if (fetchError) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '60vh' }}>
        <Card style={{ maxWidth: '540px', width: '100%', borderColor: 'rgba(239, 68, 68, 0.35)' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Unable to load your dashboard</h2>
          <p style={{ color: 'var(--text-secondary)' }}>{fetchError}</p>
        </Card>
      </div>
    );
  }

  if (bookings.length === 0) {
    return (
      <div className="page-container" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div style={{ textAlign: 'center' }}>
          <h2 style={{ marginBottom: '1rem' }}>No active lease found.</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Please approach the admin to assign you to a bed.</p>
        </div>
      </div>
    );
  }

  const today = new Date();
  const todayKey = format(today, 'yyyy-MM-dd');
  const currentMonthStart = startOfMonth(today);
  const currentMonthEnd = lastDayOfMonth(today);
  const billingMonth = format(currentMonthStart, 'yyyy-MM-dd');
  const monthlyBookings = bookings.filter((booking) => (
    booking.start_date <= format(currentMonthEnd, 'yyyy-MM-dd') &&
    (!booking.end_date || booking.end_date >= format(currentMonthStart, 'yyyy-MM-dd'))
  ));
  const currentMonthDue = monthlyBookings.reduce((sum, booking) => sum + getRentDueForBillingMonth({
    rentAmount: Number(booking.rent_amount),
    proratedRent: booking.prorated_rent != null ? Number(booking.prorated_rent) : null,
    startDate: booking.start_date,
    billingMonth,
  }), 0);
  const currentMonthPaid = payments
    .filter((payment) => payment.status === 'paid' && payment.billing_month === billingMonth)
    .reduce((sum, payment) => sum + Number(payment.amount), 0);
  const currentMonthRemaining = Math.max(currentMonthDue - currentMonthPaid, 0);
  const currentMonthPaymentStatus = getMonthlyPaymentStatus(currentMonthDue, currentMonthPaid);

  const activeBookings = bookings.filter((booking) => booking.start_date <= todayKey && (!booking.end_date || booking.end_date >= todayKey));
  const upcomingBookings = bookings.filter((booking) => booking.start_date > todayKey);
  const pastBookings = bookings.filter((booking) => booking.end_date !== null && booking.end_date < todayKey);
  const openReceiptForPayment = (payment: PaymentRecord) => {
    const relatedBooking = bookings.find((booking) => booking.id === payment.tenant_id);
    const dueAmount = relatedBooking
      ? getRentDueForBillingMonth({
        rentAmount: Number(relatedBooking.rent_amount ?? 0),
        proratedRent: relatedBooking.prorated_rent != null ? Number(relatedBooking.prorated_rent) : null,
        startDate: relatedBooking.start_date,
        billingMonth: payment.billing_month,
      })
      : 0;
    const paidAmount = payments
      .filter((item) => item.status === 'paid' && item.billing_month === payment.billing_month && item.tenant_id === payment.tenant_id)
      .reduce((sum, item) => sum + Number(item.amount), 0);
    const remainingAmount = Math.max(dueAmount - paidAmount, 0);

    openPaymentReceipt({
      receiptNumber: payment.id.slice(0, 8).toUpperCase(),
      siteName: settings.site_name,
      companyName: settings.company_name,
      supportEmail: settings.support_email,
      supportPhone: settings.support_phone,
      tenantName: relatedBooking?.name ?? 'Tenant',
      tenantEmail: relatedBooking?.email ?? '',
      tenantPhone: relatedBooking?.phone ?? '',
      roomName: relatedBooking?.room?.name ?? 'Unknown room',
      bedNumber: relatedBooking?.bed?.bed_number ?? 'Unknown',
      billingMonth: payment.billing_month,
      paymentDate: payment.payment_date,
      amount: Number(payment.amount),
      dueAmount,
      paidAmount,
      remainingAmount,
      paymentStatus: getPaymentStatusLabel(getMonthlyPaymentStatus(dueAmount, paidAmount)),
    });
  };

  return (
    <div className="page-container animate-fade-in">
      <h1 className="page-title">Welcome, {bookings[0].name}</h1>
      <p style={{ color: 'var(--text-secondary)', marginBottom: '2rem' }}>Here is your rental overview.</p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1.5rem', marginBottom: '2rem' }}>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Due This Month</div>
          <h2 style={{ fontSize: '2rem', marginTop: '0.5rem' }}>{formatCurrency(currentMonthDue)}</h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Paid This Month</div>
          <h2 style={{ fontSize: '2rem', marginTop: '0.5rem', color: 'var(--success)' }}>{formatCurrency(currentMonthPaid)}</h2>
        </Card>
        <Card>
          <div style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>Remaining This Month</div>
          <h2 style={{ fontSize: '2rem', marginTop: '0.5rem', color: 'var(--warning)' }}>{formatCurrency(currentMonthRemaining)}</h2>
          <div style={{ marginTop: '0.75rem' }}>
            <span className={`badge ${getPaymentStatusBadgeClass(currentMonthPaymentStatus)}`}>
              {getPaymentStatusLabel(currentMonthPaymentStatus)}
            </span>
          </div>
        </Card>
      </div>

      {renderBookingSection('Active Bookings', 'Your current stays and ongoing leases.', activeBookings.map((booking) => getBookingCardData(booking, today)))}
      {renderBookingSection('Upcoming Bookings', 'Reservations that start in the future.', upcomingBookings.map((booking) => getBookingCardData(booking, today)))}
      {renderBookingSection('Past Bookings', 'Completed or expired stays.', pastBookings.map((booking) => getBookingCardData(booking, today)))}

      <h2 style={{ marginBottom: '1rem', marginTop: '2rem' }}>Payment History</h2>
      <Card>
        {payments.length === 0 ? (
          <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: '1rem' }}>No payment records found.</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column' }}>
            {payments.map((payment) => {
              const relatedBooking = bookings.find((booking) => booking.id === payment.tenant_id);
              const cyclePaid = payments
                .filter((item) => item.status === 'paid' && item.billing_month === payment.billing_month && item.tenant_id === payment.tenant_id)
                .reduce((sum, item) => sum + Number(item.amount), 0);
              const cycleDue = relatedBooking
                ? getRentDueForBillingMonth({
                  rentAmount: Number(relatedBooking.rent_amount ?? 0),
                  proratedRent: relatedBooking.prorated_rent != null ? Number(relatedBooking.prorated_rent) : null,
                  startDate: relatedBooking.start_date,
                  billingMonth: payment.billing_month,
                })
                : 0;
              const cycleStatus = getMonthlyPaymentStatus(cycleDue, cyclePaid);

              return (
                <div key={payment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '1rem', borderBottom: '1px solid var(--border-light)' }}>
                  <div>
                    <div style={{ fontWeight: 600 }}>
                      {relatedBooking?.room?.name} | Bed {relatedBooking?.bed?.bed_number}
                    </div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
                      {format(new Date(payment.billing_month), 'MMM yyyy')} | Paid on {format(new Date(payment.payment_date), 'MMMM dd, yyyy')}
                    </div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                    <span style={{ fontWeight: 600 }}>{formatCurrency(Number(payment.amount))}</span>
                    <span className={`badge ${getPaymentStatusBadgeClass(cycleStatus)}`}>
                      {getPaymentStatusLabel(cycleStatus)}
                    </span>
                    <button
                      type="button"
                      onClick={() => openReceiptForPayment(payment)}
                      style={{ color: 'var(--primary)', padding: '0.25rem' }}
                      title="Open receipt"
                    >
                      <ReceiptText size={16} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
};
