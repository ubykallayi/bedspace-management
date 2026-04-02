import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { differenceInDays, format, subDays } from 'date-fns';
import { AlertCircle, Download, Pencil, Plus, Power, Search, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { MobileActionMenu } from '../../components/ui/MobileActionMenu';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { useAuth } from '../../contexts/AuthContext';
import {
  calculateProratedRent,
  downloadCsv,
  formatCurrency,
  getBookingLifecycleStatus,
  getBookingStatusBadgeClass,
  getBookingStatusLabel,
  getMonthInputValue,
  getMonthStartKey,
  isMissingColumnError,
  writeActivityLog,
} from '../../lib/admin';
import { getCachedAdminData, invalidateAdminDataCache, setCachedAdminData } from '../../lib/adminDataCache';
import { AdminAlertsData, fetchAdminAlerts, getCachedAdminAlerts } from '../../lib/adminAlerts';
import { supabase, withSupabaseTimeout } from '../../lib/supabase';
import { uploadTenantAsset } from '../../lib/tenantFiles';

type BedOption = {
  id: string;
  bed_number: string;
  status: 'vacant' | 'occupied';
  rent: number | null;
  room_id: string;
  property_id?: string;
};

type RoomRecord = {
  id: string;
  name: string;
};

type TenantRecord = {
  id: string;
  user_id: string | null;
  name: string;
  email: string;
  phone: string;
  bed_id: string;
  rent_amount: number | string;
  prorated_rent?: number | string | null;
  start_date: string;
  end_date: string | null;
  is_active?: boolean;
  updated_at?: string | null;
  updated_by?: string | null;
  property_id?: string;
  photo_url?: string | null;
  document_url?: string | null;
  bed?: BedOption | null;
  room?: RoomRecord | null;
};

type TenantFormState = {
  name: string;
  phone: string;
  email: string;
  bed_id: string;
  rent_amount: string;
  start_date: string;
  end_date: string;
  is_active: 'active' | 'inactive';
  create_initial_payment: boolean;
  payment_amount: string;
  payment_date: string;
  payment_billing_month: string;
  payment_status: 'paid' | 'pending';
  photo_url: string;
  document_url: string;
};

type RawTenantRecord = Omit<TenantRecord, 'bed' | 'room'>;

const INITIAL_FORM_STATE: TenantFormState = {
  name: '',
  phone: '',
  email: '',
  bed_id: '',
  rent_amount: '',
  start_date: '',
  end_date: '',
  is_active: 'active',
  create_initial_payment: false,
  payment_amount: '',
  payment_date: new Date().toISOString().split('T')[0],
  payment_billing_month: getMonthStartKey(new Date()),
  payment_status: 'paid',
  photo_url: '',
  document_url: '',
};

const BASE_TENANT_SELECT = 'id, user_id, name, email, phone, bed_id, rent_amount, prorated_rent, start_date, end_date';
const LEGACY_TENANT_SELECT = 'id, user_id, name, email, phone, bed_id, rent_amount, start_date, end_date';
const ENHANCED_TENANT_SELECT = `${BASE_TENANT_SELECT}, is_active, updated_at, updated_by`;
const LEGACY_ENHANCED_TENANT_SELECT = `${LEGACY_TENANT_SELECT}, is_active, updated_at, updated_by`;
const TENANTS_CACHE_KEY = 'tenants-page';

export const Tenants = () => {
  const { user } = useAuth();
  const { selectedProperty, selectedPropertyId, isLoading: propertiesLoading, error: propertiesError } = useAdminProperty();
  const [tenants, setTenants] = useState<TenantRecord[]>([]);
  const [beds, setBeds] = useState<BedOption[]>([]);
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [formError, setFormError] = useState('');
  const [editingTenantId, setEditingTenantId] = useState<string | null>(null);
  const [tenantSchemaSupportsAdminStatus, setTenantSchemaSupportsAdminStatus] = useState(false);
  const [tenantSchemaSupportsProratedRent, setTenantSchemaSupportsProratedRent] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [bookingStatusFilter, setBookingStatusFilter] = useState('all');
  const [activationFilter, setActivationFilter] = useState('all');
  const [roomFilter, setRoomFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [alerts, setAlerts] = useState<AdminAlertsData>({ unpaidTenants: [], expiringTenants: [] });
  const [pendingAction, setPendingAction] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    tone: 'danger' | 'warning';
    action: () => Promise<void>;
  }>(null);
  const [formData, setFormData] = useState<TenantFormState>(INITIAL_FORM_STATE);
  const [tenantPhotoFile, setTenantPhotoFile] = useState<File | null>(null);
  const [tenantDocumentFile, setTenantDocumentFile] = useState<File | null>(null);
  const formCardRef = useRef<HTMLDivElement | null>(null);

  const attachRoomAndBed = useCallback((tenantRows: RawTenantRecord[], bedRows: BedOption[], roomRows: RoomRecord[]) => (
    tenantRows.map((tenant) => {
      const bed = bedRows.find((item) => item.id === tenant.bed_id) ?? null;
      const room = bed ? roomRows.find((item) => item.id === bed.room_id) ?? null : null;

      return {
        ...tenant,
        bed,
        room,
      };
    })
  ), []);

  const fetchData = useCallback(async () => {
    if (!selectedPropertyId) {
      setTenantSchemaSupportsAdminStatus(false);
      setTenantSchemaSupportsProratedRent(true);
      setBeds([]);
      setRooms([]);
      setTenants([]);
      setFetchError('');
      setLoading(false);
      return;
    }

    const cacheKey = `${TENANTS_CACHE_KEY}:${selectedPropertyId}`;
    const cached = getCachedAdminData<{
      tenants: TenantRecord[];
      beds: BedOption[];
      rooms: RoomRecord[];
      tenantSchemaSupportsAdminStatus: boolean;
      tenantSchemaSupportsProratedRent: boolean;
    }>(cacheKey);

    if (cached) {
      setTenantSchemaSupportsAdminStatus(cached.tenantSchemaSupportsAdminStatus);
      setTenantSchemaSupportsProratedRent(cached.tenantSchemaSupportsProratedRent);
      setBeds(cached.beds);
      setRooms(cached.rooms);
      setTenants(cached.tenants);
      setLoading(false);
    } else {
      setLoading(true);
    }
    setFetchError('');

    try {
      let tenantRows: RawTenantRecord[] = [];
      let schemaSupportsAdminStatus = true;
      let schemaSupportsProratedRent = true;

      const tenantQueries = [
        { select: ENHANCED_TENANT_SELECT, supportsAdminStatus: true, supportsProratedRent: true },
        { select: LEGACY_ENHANCED_TENANT_SELECT, supportsAdminStatus: true, supportsProratedRent: false },
        { select: BASE_TENANT_SELECT, supportsAdminStatus: false, supportsProratedRent: true },
        { select: LEGACY_TENANT_SELECT, supportsAdminStatus: false, supportsProratedRent: false },
      ] as const;

      for (const tenantQuery of tenantQueries) {
        const tenantResult = await withSupabaseTimeout(
          supabase
            .from('tenants')
            .select(tenantQuery.select)
            .eq('property_id', selectedPropertyId)
            .order('start_date', { ascending: false }),
          'Tenants took too long to load. Please try again.',
        );

        if (!tenantResult.error) {
          tenantRows = (tenantResult.data ?? []) as unknown as RawTenantRecord[];
          schemaSupportsAdminStatus = tenantQuery.supportsAdminStatus;
          schemaSupportsProratedRent = tenantQuery.supportsProratedRent;
          break;
        }

        if (!isMissingColumnError(tenantResult.error)) {
          console.error('Tenant fetch error:', tenantResult.error);
          setFetchError(tenantResult.error.message || 'Unable to load tenant records.');
          break;
        }
      }

      const filesResult = await withSupabaseTimeout(
        supabase
          .from('tenants')
          .select('id, photo_url, document_url')
          .eq('property_id', selectedPropertyId),
        'Tenant files took too long to load. Please try again.',
      );
      if (!filesResult.error) {
        const filesById = new Map(
          ((filesResult.data ?? []) as Array<{ id: string; photo_url?: string | null; document_url?: string | null }>)
            .map((row) => [row.id, row]),
        );
        tenantRows = tenantRows.map((tenant) => {
          const fileInfo = filesById.get(tenant.id);
          return {
            ...tenant,
            photo_url: fileInfo?.photo_url ?? null,
            document_url: fileInfo?.document_url ?? null,
          };
        });
      }

      const [
        { data: bedsData, error: bedsError },
        { data: roomsData, error: roomsError },
      ] = await withSupabaseTimeout(
        Promise.all([
          supabase
            .from('beds')
            .select('id, bed_number, status, rent, room_id, property_id')
            .eq('property_id', selectedPropertyId)
            .order('bed_number'),
          supabase
            .from('rooms')
            .select('id, name')
            .eq('property_id', selectedPropertyId)
            .order('name'),
        ]),
        'Beds and rooms took too long to load. Please try again.',
      );

      if (bedsError) {
        console.error('Beds fetch error:', bedsError);
        setFetchError((current) => current || bedsError.message || 'Unable to load beds.');
      }
      if (roomsError) {
        console.error('Rooms fetch error:', roomsError);
        setFetchError((current) => current || roomsError.message || 'Unable to load rooms.');
      }

      const safeBeds = (bedsData ?? []) as BedOption[];
      const safeRooms = (roomsData ?? []) as RoomRecord[];

      setTenantSchemaSupportsAdminStatus(schemaSupportsAdminStatus);
      setTenantSchemaSupportsProratedRent(schemaSupportsProratedRent);
      setBeds(safeBeds);
      setRooms(safeRooms);
      const enrichedTenants = attachRoomAndBed(tenantRows, safeBeds, safeRooms);
      setTenants(enrichedTenants);
      setCachedAdminData(cacheKey, {
        tenants: enrichedTenants,
        beds: safeBeds,
        rooms: safeRooms,
        tenantSchemaSupportsAdminStatus: schemaSupportsAdminStatus,
        tenantSchemaSupportsProratedRent: schemaSupportsProratedRent,
      });
    } catch (nextError) {
      console.error('Tenants fetch crash:', nextError);
      setFetchError(nextError instanceof Error ? nextError.message : 'Unable to load tenant records.');
    } finally {
      setLoading(false);
    }
  }, [attachRoomAndBed, selectedPropertyId]);

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
      .catch((error) => {
        console.error('Tenant alerts error:', error);
      });
  }, [selectedPropertyId, tenants]);

  const resetForm = () => {
    setFormData(INITIAL_FORM_STATE);
    setTenantPhotoFile(null);
    setTenantDocumentFile(null);
    setFormError('');
    setEditingTenantId(null);
    setShowForm(false);
  };

  const formatDateForDb = (date: Date) => format(date, 'yyyy-MM-dd');

  const getBedLabel = (bed: BedOption) => {
    const room = rooms.find((item) => item.id === bed.room_id);
    return `${room?.name ?? 'Room'} - ${bed.bed_number}`;
  };

  const getCurrentOccupant = (bedId: string) => {
    const today = formatDateForDb(new Date());

    return tenants.find((tenant) => (
      tenant.bed_id === bedId &&
      tenant.start_date <= today &&
      (!tenant.end_date || tenant.end_date >= today) &&
      tenant.is_active !== false
    ));
  };

  const getComputedProratedRent = (rentAmountValue: string, startDateValue: string) => {
    const parsedRentAmount = Number(rentAmountValue);
    if (Number.isNaN(parsedRentAmount) || parsedRentAmount <= 0 || !startDateValue) return 0;
    return calculateProratedRent(parsedRentAmount, startDateValue);
  };

  const syncBedStatuses = async (bedIds: string[]) => {
    const uniqueBedIds = [...new Set(bedIds.filter(Boolean))];
    const today = formatDateForDb(new Date());

    await Promise.all(uniqueBedIds.map(async (bedId) => {
      const { data: relatedTenants, error: relatedTenantsError } = await supabase
        .from('tenants')
        .select('id')
        .eq('bed_id', bedId)
        .eq('property_id', selectedPropertyId)
        .lte('start_date', today)
        .or(`end_date.is.null,end_date.gte.${today}`);

      if (relatedTenantsError) throw relatedTenantsError;

      const status = relatedTenants && relatedTenants.length > 0 ? 'occupied' : 'vacant';
      const { error: updateError } = await supabase
        .from('beds')
        .update({ status })
        .eq('id', bedId);

      if (updateError) throw updateError;
    }));
  };

  const prepareBooking = (bedId: string, startDateValue: string, endDateValue: string, excludeTenantId?: string | null) => {
    if (!bedId) {
      return { error: 'Please select a room and bed before saving the tenant.' };
    }

    const selectedBed = beds.find((bed) => bed.id === bedId);
    if (!selectedBed) {
      return { error: 'The selected bed could not be found. Please refresh and try again.' };
    }

    if (!startDateValue) {
      return { error: 'Please select a start date.' };
    }

    const startDate = new Date(startDateValue);
    if (Number.isNaN(startDate.getTime())) {
      return { error: 'Start date is invalid.' };
    }

    const normalizedEndDate = endDateValue ? new Date(endDateValue) : null;
    if (normalizedEndDate && Number.isNaN(normalizedEndDate.getTime())) {
      return { error: 'End date is invalid.' };
    }

    if (normalizedEndDate && normalizedEndDate < startDate) {
      return { error: 'End date must be the same day or after the start date.' };
    }

    const bedTenants = tenants
      .filter((tenant) => tenant.bed_id === bedId && tenant.id !== excludeTenantId)
      .sort((left, right) => left.start_date.localeCompare(right.start_date));

    if (bedTenants.some((tenant) => tenant.start_date === startDateValue)) {
      return { error: 'Another tenant already starts on this bed on the selected date.' };
    }

    const previousTenant = [...bedTenants]
      .filter((tenant) => tenant.start_date < startDateValue)
      .sort((left, right) => right.start_date.localeCompare(left.start_date))[0];
    const nextTenant = bedTenants.find((tenant) => tenant.start_date > startDateValue) || null;

    let previousTenantEndDate: string | null = null;
    if (previousTenant && (!previousTenant.end_date || previousTenant.end_date >= startDateValue)) {
      const adjustedEndDate = subDays(startDate, 1);

      if (formatDateForDb(adjustedEndDate) < previousTenant.start_date) {
        return { error: 'The selected start date conflicts with an existing tenant booking on this bed.' };
      }

      previousTenantEndDate = formatDateForDb(adjustedEndDate);
    }

    let finalEndDate = endDateValue || null;
    if (nextTenant) {
      const nextStartDate = new Date(nextTenant.start_date);

      if (!finalEndDate) {
        const adjustedEndDate = subDays(nextStartDate, 1);

        if (adjustedEndDate < startDate) {
          return { error: 'The selected start date conflicts with an upcoming booking on this bed.' };
        }

        finalEndDate = formatDateForDb(adjustedEndDate);
      } else if (new Date(finalEndDate) >= nextStartDate) {
        return { error: `This booking overlaps with another tenant who starts on ${format(nextStartDate, 'MMM dd, yyyy')}.` };
      }
    }

    return {
      selectedBed,
      previousTenantId: previousTenantEndDate ? previousTenant?.id ?? null : null,
      previousTenantEndDate,
      finalEndDate,
    };
  };

  const handleAddTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError('');

    if (!selectedPropertyId) {
      setFormError('Please select a property before saving a tenant.');
      return;
    }

    try {
      const bookingPreparation = prepareBooking(formData.bed_id, formData.start_date, formData.end_date, editingTenantId);
      if ('error' in bookingPreparation) {
        setFormError(bookingPreparation.error ?? 'Unable to prepare the booking.');
        return;
      }

      const existingTenant = editingTenantId
        ? tenants.find((tenant) => tenant.id === editingTenantId)
        : null;
      const normalizedEmail = formData.email.trim().toLowerCase();
      const userId = existingTenant?.user_id ?? null;
      const finalRent = formData.rent_amount
        ? Number(formData.rent_amount)
        : bookingPreparation.selectedBed.rent ?? 0;
      const shouldCreateInitialPayment = !editingTenantId && formData.create_initial_payment;
      const proratedRent = calculateProratedRent(finalRent, formData.start_date);

      if (shouldCreateInitialPayment) {
        const parsedPaymentAmount = Number(formData.payment_amount);
        if (Number.isNaN(parsedPaymentAmount) || parsedPaymentAmount <= 0) {
          setFormError('Please enter a valid initial payment amount.');
          return;
        }
      }

      const tenantPayload: Record<string, string | number | null | boolean> = {
        user_id: userId,
        name: formData.name.trim(),
        email: normalizedEmail,
        phone: formData.phone.trim(),
        bed_id: formData.bed_id,
        property_id: selectedPropertyId,
        rent_amount: finalRent,
        prorated_rent: proratedRent,
        start_date: formData.start_date,
        end_date: bookingPreparation.finalEndDate,
      };

      if (!tenantSchemaSupportsProratedRent) {
        delete tenantPayload.prorated_rent;
      }

      if (tenantSchemaSupportsAdminStatus) {
        tenantPayload.is_active = formData.is_active === 'active';
        tenantPayload.updated_by = user?.id ?? null;
        tenantPayload.updated_at = new Date().toISOString();
      }

      if (bookingPreparation.previousTenantId && bookingPreparation.previousTenantEndDate) {
        const previousTenantUpdatePayload: Record<string, string | null> = {
          end_date: bookingPreparation.previousTenantEndDate,
        };

        if (tenantSchemaSupportsAdminStatus) {
          previousTenantUpdatePayload.updated_by = user?.id ?? null;
          previousTenantUpdatePayload.updated_at = new Date().toISOString();
        }

        const { error: previousTenantUpdateError } = await supabase
          .from('tenants')
          .update(previousTenantUpdatePayload)
          .eq('id', bookingPreparation.previousTenantId);

        if (previousTenantUpdateError) throw previousTenantUpdateError;
      }

      const previousBedId = editingTenantId
        ? tenants.find((tenant) => tenant.id === editingTenantId)?.bed_id ?? null
        : null;

      const { data: savedTenant, error } = editingTenantId
        ? await supabase
          .from('tenants')
          .update(tenantPayload)
          .eq('id', editingTenantId)
          .select('id')
          .single()
        : await supabase
          .from('tenants')
          .insert([tenantPayload])
          .select('id')
          .single();

      if (error) throw error;
      const tenantId = savedTenant?.id ?? editingTenantId;
      if (!tenantId) throw new Error('Unable to resolve tenant id for file upload.');

      let nextPhotoUrl = formData.photo_url.trim() || null;
      let nextDocumentUrl = formData.document_url.trim() || null;
      if (tenantPhotoFile) {
        nextPhotoUrl = await uploadTenantAsset({ tenantId, file: tenantPhotoFile, assetType: 'photo' });
      }
      if (tenantDocumentFile) {
        nextDocumentUrl = await uploadTenantAsset({ tenantId, file: tenantDocumentFile, assetType: 'document' });
      }
      if (nextPhotoUrl !== existingTenant?.photo_url || nextDocumentUrl !== existingTenant?.document_url) {
        await supabase
          .from('tenants')
          .update({
            photo_url: nextPhotoUrl,
            document_url: nextDocumentUrl,
          })
          .eq('id', tenantId);
      }

      if (shouldCreateInitialPayment && savedTenant?.id) {
        const initialPaymentPayload: Record<string, string | number | null> = {
          tenant_id: savedTenant.id,
          amount: Number(formData.payment_amount),
          payment_date: formData.payment_date,
          billing_month: formData.payment_billing_month,
          status: formData.payment_status,
        };

        const { data: savedPayment, error: paymentError } = await supabase
          .from('payments')
          .insert([initialPaymentPayload])
          .select('id')
          .single();

        if (paymentError) throw paymentError;

        await writeActivityLog({
          action: 'payment.created',
          entityType: 'payment',
          entityId: savedPayment?.id ?? '',
          description: `Recorded initial payment for ${formData.name.trim()} while creating the tenant booking.`,
          actorId: user?.id,
        });
      }

      invalidateAdminDataCache();
      await syncBedStatuses([formData.bed_id, previousBedId ?? '']);
      await writeActivityLog({
        action: editingTenantId ? 'tenant.updated' : 'tenant.created',
        entityType: 'tenant',
        entityId: tenantId,
        description: editingTenantId
          ? `Updated tenant ${formData.name.trim()} and booking details.`
          : `Created tenant ${formData.name.trim()} and assigned bed ${bookingPreparation.selectedBed.bed_number}.`,
        actorId: user?.id,
      });
      await fetchData();
      resetForm();
    } catch (error) {
      console.error('Error saving tenant:', error);
      setFormError(error instanceof Error ? error.message : 'Error saving tenant');
    }
  };

  const handleEdit = (tenant: TenantRecord) => {
    setEditingTenantId(tenant.id);
    setFormError('');
    setShowForm(true);
    setFormData({
      name: tenant.name,
      phone: tenant.phone,
      email: tenant.email,
      bed_id: tenant.bed_id,
      rent_amount: String(tenant.rent_amount ?? ''),
      start_date: tenant.start_date,
      end_date: tenant.end_date ?? '',
      is_active: tenant.is_active === false ? 'inactive' : 'active',
      create_initial_payment: false,
      payment_amount: '',
      payment_date: new Date().toISOString().split('T')[0],
      payment_billing_month: getMonthStartKey(new Date()),
      payment_status: 'paid',
      photo_url: tenant.photo_url ?? '',
      document_url: tenant.document_url ?? '',
    });
    setTenantPhotoFile(null);
    setTenantDocumentFile(null);
    window.requestAnimationFrame(() => {
      formCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const performDelete = async (id: string, bedId: string, name: string) => {
    try {
      const { error } = await supabase.from('tenants').delete().eq('id', id);
      if (error) throw error;

      invalidateAdminDataCache();
      await syncBedStatuses([bedId]);
      await writeActivityLog({
        action: 'tenant.deleted',
        entityType: 'tenant',
        entityId: id,
        description: `Deleted tenant record for ${name}.`,
        actorId: user?.id,
      });
      await fetchData();
    } catch (error) {
      console.error('Error deleting tenant:', error);
      setFormError(error instanceof Error ? error.message : 'Error deleting tenant');
    }
  };

  const performToggleActivation = async (tenant: TenantRecord) => {
    if (!tenantSchemaSupportsAdminStatus) {
      setFormError('Manual active/inactive control needs the latest tenant status migration in Supabase.');
      return;
    }

    try {
      const nextIsActive = tenant.is_active === false;
      const { error } = await supabase
        .from('tenants')
        .update({
          is_active: nextIsActive,
          updated_at: new Date().toISOString(),
          updated_by: user?.id ?? null,
        })
        .eq('id', tenant.id);

      if (error) throw error;

      invalidateAdminDataCache();
      await writeActivityLog({
        action: nextIsActive ? 'tenant.activated' : 'tenant.deactivated',
        entityType: 'tenant',
        entityId: tenant.id,
        description: `${nextIsActive ? 'Activated' : 'Deactivated'} tenant ${tenant.name}.`,
        actorId: user?.id,
      });
      await fetchData();
    } catch (error) {
      console.error('Error updating tenant status:', error);
      setFormError(error instanceof Error ? error.message : 'Error updating tenant status');
    }
  };

  const tenantsWithStatus = useMemo(() => {
    return tenants.map((tenant) => {
      const bookingStatus = getBookingLifecycleStatus(
        tenant.start_date,
        tenant.end_date,
        tenant.is_active !== false,
      );

      return {
        ...tenant,
        bookingStatus,
      };
    });
  }, [tenants]);

  const filteredTenants = useMemo(() => {
    const normalizedSearch = searchQuery.trim().toLowerCase();

    return tenantsWithStatus.filter((tenant) => {
      const matchesSearch = normalizedSearch.length === 0 || [
        tenant.name,
        tenant.email,
        tenant.phone,
        tenant.room?.name ?? '',
        tenant.bed?.bed_number ?? '',
      ].some((value) => value.toLowerCase().includes(normalizedSearch));
      const matchesBookingStatus = bookingStatusFilter === 'all' || tenant.bookingStatus === bookingStatusFilter;
      const matchesActivation = activationFilter === 'all'
        || (activationFilter === 'active' && tenant.is_active !== false)
        || (activationFilter === 'inactive' && tenant.is_active === false);
      const matchesRoom = roomFilter === 'all' || tenant.room?.id === roomFilter;

      return matchesSearch && matchesBookingStatus && matchesActivation && matchesRoom;
    });
  }, [activationFilter, bookingStatusFilter, roomFilter, searchQuery, tenantsWithStatus]);

  const exportTenantsCsv = () => {
    downloadCsv(
      `tenants-${format(new Date(), 'yyyy-MM-dd')}.csv`,
      ['Tenant', 'Email', 'Phone', 'Room', 'Bed', 'Booking Status', 'Manual Status', 'Rent', 'Start Date', 'End Date', 'Updated At'],
      filteredTenants.map((tenant) => [
        tenant.name,
        tenant.email,
        tenant.phone,
        tenant.room?.name ?? 'Unknown room',
        tenant.bed?.bed_number ?? 'Unknown bed',
        getBookingStatusLabel(tenant.bookingStatus),
        tenant.is_active === false ? 'Inactive' : 'Active',
        Number(tenant.rent_amount),
        tenant.start_date,
        tenant.end_date ?? 'Ongoing',
        tenant.updated_at ?? '',
      ]),
    );
  };

  if (loading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading tenants...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are pulling tenant, room, and bed data now.</p>
        </Card>
      </div>
    );
  }

  if (propertiesLoading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading properties...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are loading the property list before opening tenant records.</p>
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
            {propertiesError || 'Create your first property in Settings to start assigning tenants.'}
          </p>
        </Card>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="page-container">
        <Card style={{ borderColor: 'rgba(239, 68, 68, 0.35)' }}>
          <h2 style={{ marginBottom: '0.75rem' }}>Unable to load the tenant page</h2>
          <p style={{ color: 'var(--text-secondary)', marginBottom: '1rem' }}>
            {fetchError}
          </p>
          <p style={{ color: 'var(--text-tertiary)', marginBottom: '1rem' }}>
            This usually means a real data or permission issue, not an empty list.
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
          <h1 className="page-title">Tenants</h1>
          <p style={{ color: 'var(--text-secondary)' }}>
            Manage current residents, future bookings, and contract status for {selectedProperty?.name ?? 'the selected property'}.
          </p>
        </div>
        <div className="admin-toolbar">
          <Button
            variant="secondary"
            onClick={() => setShowFilters((value) => !value)}
            aria-label={showFilters ? 'Hide search and filters' : 'Show search and filters'}
            title={showFilters ? 'Hide search and filters' : 'Show search and filters'}
          >
            <Search size={16} />
          </Button>
          <Button className="desktop-only" variant="secondary" onClick={exportTenantsCsv}>
            <Download size={16} /> Export CSV
          </Button>
          <MobileActionMenu
            items={[
              { label: 'Export CSV', onClick: exportTenantsCsv },
            ]}
          />
          <Button
            onClick={() => {
              if (showForm) resetForm();
              else setShowForm(true);
            }}
          >
            {showForm ? 'Cancel' : <><Plus size={18} /> Add Tenant</>}
          </Button>
        </div>
      </div>

      {!tenantSchemaSupportsAdminStatus && (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Tenant status and audit fields need one SQL migration</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            Search, booking badges, and exports are ready now. Manual active/inactive control and audit stamps will start saving as soon as `tenants.is_active`, `tenants.updated_at`, and `tenants.updated_by` exist in Supabase.
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

      {showFilters && (
      <Card className="toolbar-panel">
        <div className="toolbar-panel-header">
          <div>
            <h3 style={{ marginBottom: '0.35rem' }}>Search and filters</h3>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>Filter the list without affecting the add or edit form.</p>
          </div>
          <Button variant="secondary" onClick={() => {
            setSearchQuery('');
            setBookingStatusFilter('all');
            setActivationFilter('all');
            setRoomFilter('all');
          }}>
            Clear Filters
          </Button>
        </div>

        <div className="toolbar-panel-grid">
          <Input
            label="Search"
            placeholder="Name, email, phone, room, or bed"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
          />

          <div className="form-group">
            <label className="form-label">Booking Status</label>
            <select className="form-select" value={bookingStatusFilter} onChange={(e) => setBookingStatusFilter(e.target.value)}>
              <option value="all">All bookings</option>
              <option value="active">Active</option>
              <option value="upcoming">Upcoming</option>
              <option value="expired">Expired</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Tenant Status</label>
            <select className="form-select" value={activationFilter} onChange={(e) => setActivationFilter(e.target.value)}>
              <option value="all">All tenants</option>
              <option value="active">Active only</option>
              <option value="inactive">Inactive only</option>
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Room</label>
            <select className="form-select" value={roomFilter} onChange={(e) => setRoomFilter(e.target.value)}>
              <option value="all">All rooms</option>
              {rooms.map((room) => (
                <option key={room.id} value={room.id}>{room.name}</option>
              ))}
            </select>
          </div>
        </div>
      </Card>
      )}

      {showForm && (
        <Card ref={formCardRef} style={{ marginBottom: '2rem', borderColor: editingTenantId ? 'var(--primary)' : undefined }}>
          <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ marginBottom: '0.25rem' }}>{editingTenantId ? 'Edit Tenant' : 'Add Tenant'}</h3>
              <p style={{ color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                {editingTenantId ? 'You are editing the selected tenant below.' : 'Create a tenant booking and optionally record the first payment.'}
              </p>
            </div>
            {editingTenantId && (
              <div className="badge badge-warning">
                Editing Mode
              </div>
            )}
          </div>
          <form onSubmit={handleAddTenant} className="tenant-form-grid">
            <div className="tenant-form-profile">
              <div>
                {(tenantPhotoFile || formData.photo_url) ? (
                  <img
                    src={tenantPhotoFile ? URL.createObjectURL(tenantPhotoFile) : formData.photo_url}
                    alt={formData.name || 'Tenant photo'}
                    style={{ width: '56px', height: '56px', borderRadius: '999px', objectFit: 'cover', border: '1px solid var(--border-light)' }}
                  />
                ) : (
                  <div style={{
                    width: '56px',
                    height: '56px',
                    borderRadius: '999px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--primary-glow)',
                    fontWeight: 600,
                    fontSize: '0.9rem',
                  }}>
                    {(formData.name || 'TN').slice(0, 2).toUpperCase()}
                  </div>
                )}
              </div>
              <div style={{ flex: '1 1 auto', minWidth: 0 }}>
                <Input label="Full Name" required value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              </div>
            </div>
            <Input label="Phone Number" required value={formData.phone} onChange={(e) => setFormData({ ...formData, phone: e.target.value })} />
            <Input label="Tenant Email" required value={formData.email} onChange={(e) => setFormData({ ...formData, email: e.target.value })} />
            <Input
              label="Photo URL (optional)"
              value={formData.photo_url}
              onChange={(e) => setFormData({ ...formData, photo_url: e.target.value })}
              placeholder="https://..."
            />
            <Input
              label="Document URL (optional)"
              value={formData.document_url}
              onChange={(e) => setFormData({ ...formData, document_url: e.target.value })}
              placeholder="https://..."
            />
            <div className="form-group">
              <label className="form-label">Upload Photo (optional)</label>
              <input
                className="form-input"
                type="file"
                accept="image/*"
                onChange={(e) => setTenantPhotoFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="form-group">
              <label className="form-label">Upload Document (optional)</label>
              <input
                className="form-input"
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,.webp"
                onChange={(e) => setTenantDocumentFile(e.target.files?.[0] ?? null)}
              />
            </div>

            <div className="form-group">
              <label className="form-label">Assign Room & Bed</label>
              <select
                className="form-select"
                required
                value={formData.bed_id}
                onChange={(e) => {
                  setFormError('');
                  const selectedBed = beds.find((bed) => bed.id === e.target.value);
                  setFormData({
                    ...formData,
                    bed_id: e.target.value,
                    rent_amount: selectedBed?.rent != null ? String(selectedBed.rent) : '',
                    payment_amount: formData.create_initial_payment
                      ? selectedBed?.rent != null && formData.start_date
                        ? String(calculateProratedRent(Number(selectedBed.rent), formData.start_date))
                        : selectedBed?.rent != null ? String(selectedBed.rent) : formData.payment_amount
                      : formData.payment_amount,
                  });
                }}
              >
                <option value="">Select a bed...</option>
                {beds.map((bed) => {
                  const currentOccupant = getCurrentOccupant(bed.id);
                  const occupancyLabel = currentOccupant
                    ? `Occupied by ${currentOccupant.name} | Advanced booking`
                    : 'Available now';

                  return (
                    <option key={bed.id} value={bed.id}>
                      {getBedLabel(bed)} | {occupancyLabel}
                    </option>
                  );
                })}
              </select>
            </div>

            <Input
              type="number"
              label="Monthly Rent (AED)"
              required
              value={formData.rent_amount}
              onChange={(e) => setFormData({
                ...formData,
                rent_amount: e.target.value,
                payment_amount: formData.create_initial_payment
                  ? String(getComputedProratedRent(e.target.value, formData.start_date) || Number(e.target.value || 0))
                  : formData.payment_amount,
              })}
            />
            <Input
              type="date"
              label="Start Date"
              required
              value={formData.start_date}
              onChange={(e) => setFormData({
                ...formData,
                start_date: e.target.value,
                payment_billing_month: e.target.value ? getMonthStartKey(e.target.value) : formData.payment_billing_month,
                payment_date: !editingTenantId && formData.create_initial_payment ? e.target.value : formData.payment_date,
                payment_amount: !editingTenantId && formData.create_initial_payment
                  ? String(getComputedProratedRent(formData.rent_amount, e.target.value) || Number(formData.rent_amount || 0))
                  : formData.payment_amount,
              })}
            />
            <Input type="date" label="End Date (Optional)" value={formData.end_date} onChange={(e) => setFormData({ ...formData, end_date: e.target.value })} />

            <div className="form-group">
              <label className="form-label">Tenant Status</label>
              <select
                className="form-select"
                value={formData.is_active}
                disabled={!tenantSchemaSupportsAdminStatus}
                onChange={(e) => setFormData({ ...formData, is_active: e.target.value as 'active' | 'inactive' })}
              >
                <option value="active">Active</option>
                <option value="inactive">Inactive</option>
              </select>
            </div>

            {!editingTenantId && (
              <div style={{ gridColumn: '1 / -1', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: formData.create_initial_payment ? '1rem' : 0 }}>
                  <div>
                    <h3 style={{ marginBottom: '0.25rem', fontSize: '1rem' }}>Optional initial payment</h3>
                    <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                      Turn this on if you want the first payment to be recorded automatically when the tenant is created.
                    </p>
                  </div>
                  <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-primary)', fontWeight: 600 }}>
                    <input
                      type="checkbox"
                      checked={formData.create_initial_payment}
                      onChange={(e) => setFormData({
                        ...formData,
                        create_initial_payment: e.target.checked,
                        payment_amount: e.target.checked
                          ? String(getComputedProratedRent(formData.rent_amount, formData.start_date) || Number(formData.rent_amount || 0))
                          : '',
                        payment_billing_month: e.target.checked
                          ? (formData.start_date ? getMonthStartKey(formData.start_date) : getMonthStartKey(new Date()))
                          : formData.payment_billing_month,
                        payment_date: e.target.checked
                          ? (formData.start_date || new Date().toISOString().split('T')[0])
                          : formData.payment_date,
                      })}
                    />
                    Record payment now
                  </label>
                </div>

                {formData.create_initial_payment && (
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem' }}>
                    <Input
                      type="number"
                      label="Payment Amount (AED)"
                      required
                      value={formData.payment_amount}
                      onChange={(e) => setFormData({ ...formData, payment_amount: e.target.value })}
                    />
                    <Input
                      type="month"
                      label="Rent Month"
                      required
                      value={getMonthInputValue(formData.payment_billing_month)}
                      onChange={(e) => setFormData({ ...formData, payment_billing_month: `${e.target.value}-01` })}
                    />
                    <Input
                      type="date"
                      label="Payment Date"
                      required
                      value={formData.payment_date}
                      onChange={(e) => setFormData({ ...formData, payment_date: e.target.value })}
                    />
                    <div className="form-group">
                      <label className="form-label">Payment Status</label>
                      <select
                        className="form-select"
                        value={formData.payment_status}
                        onChange={(e) => setFormData({ ...formData, payment_status: e.target.value as 'paid' | 'pending' })}
                      >
                        <option value="paid">Paid</option>
                        <option value="pending">Pending</option>
                      </select>
                    </div>
                  </div>
                )}
              </div>
            )}

            {formError && (
              <div style={{ gridColumn: '1 / -1', color: 'var(--danger)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}>
                {formError}
              </div>
            )}

            {beds.length === 0 && (
              <div style={{ gridColumn: '1 / -1', color: 'var(--warning)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--warning-bg)', borderRadius: 'var(--radius-sm)' }}>
                No beds are available yet. Add beds on the Rooms page before assigning a tenant.
              </div>
            )}

            <p style={{ gridColumn: '1 / -1', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
              You can assign any email now. When that tenant signs up with the same email later, the portal can be linked to this booking. Bed rent auto-fills on selection, and the first month is saved as prorated rent based on the start date.
            </p>

            <div className="tenant-form-submit">
              <Button type="submit" disabled={beds.length === 0}>{editingTenantId ? 'Update Tenant' : 'Save Tenant'}</Button>
            </div>
          </form>
        </Card>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        {filteredTenants.length === 0 && tenants.length > 0 && (
          <Card style={{ padding: '2rem', textAlign: 'center' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>No tenants match these filters</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Try clearing the search or switching room and status filters.</p>
          </Card>
        )}

        {tenants.length === 0 && (
          <Card style={{ padding: '2rem', textAlign: 'center' }}>
            <h3 style={{ marginBottom: '0.5rem' }}>No tenants added yet</h3>
            <p style={{ color: 'var(--text-secondary)' }}>Use Add Tenant to create the first booking once rooms and beds are ready.</p>
          </Card>
        )}

        {filteredTenants.map((tenant) => {
          const bookingStatus = tenant.bookingStatus;
          const isUnpaid = alerts.unpaidTenants.some((item) => item.id === tenant.id);
          const isExpiringSoon = alerts.expiringTenants.some((item) => item.id === tenant.id);
          const daysLeft = tenant.end_date ? differenceInDays(new Date(tenant.end_date), new Date()) : null;
          const nearingExpiry = bookingStatus === 'active' && daysLeft !== null && daysLeft <= 7 && daysLeft >= 0;
          const contractPeriodLabel = tenant.end_date
            ? `${format(new Date(tenant.start_date), 'MMM dd')} - ${format(new Date(tenant.end_date), 'MMM dd, yyyy')}`
            : `${format(new Date(tenant.start_date), 'MMM dd')} - Ongoing`;

          return (
            <Card key={tenant.id} style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '1.25rem',
              gap: '1rem',
              flexWrap: 'wrap',
              borderColor: editingTenantId === tenant.id
                ? 'var(--primary)'
                : isUnpaid
                  ? 'rgba(239, 68, 68, 0.4)'
                  : isExpiringSoon
                    ? 'rgba(245, 158, 11, 0.45)'
                    : undefined,
              background: isUnpaid
                ? 'rgba(127, 29, 29, 0.12)'
                : isExpiringSoon
                  ? 'rgba(120, 53, 15, 0.12)'
                  : undefined,
            }}>
              <div>
              <h3 style={{ fontSize: '1.1rem', marginBottom: '0.35rem', display: 'flex', alignItems: 'center', gap: '0.65rem', flexWrap: 'wrap' }}>
                {tenant.photo_url ? (
                  <img src={tenant.photo_url} alt={tenant.name} style={{ width: '48px', height: '48px', borderRadius: '999px', objectFit: 'cover', border: '1px solid var(--border-light)' }} />
                ) : (
                  <span style={{ width: '48px', height: '48px', borderRadius: '999px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary-glow)', fontSize: '0.85rem', fontWeight: 600 }}>
                    {tenant.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                  <span>{tenant.name}</span>
                  <span className={`badge ${getBookingStatusBadgeClass(bookingStatus)}`}>
                    {getBookingStatusLabel(bookingStatus)}
                  </span>
                  {isUnpaid && <span className="badge badge-danger">Unpaid Rent</span>}
                  {nearingExpiry && <AlertCircle size={16} color="var(--warning)" />}
                </h3>
                <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.25rem' }}>
                  {tenant.room?.name ?? 'Room unavailable'} | Bed {tenant.bed?.bed_number ?? 'Unknown'} | {tenant.phone}
                </p>
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>{tenant.email}</p>
                {tenant.document_url ? (
                  <a href={tenant.document_url} target="_blank" rel="noreferrer" style={{ color: 'var(--primary)', fontSize: '0.85rem' }}>
                    View document
                  </a>
                ) : null}
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap', marginLeft: 'auto' }}>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Contract Period</div>
                  <div style={{ fontSize: '0.875rem', fontWeight: 500 }}>
                    {contractPeriodLabel}
                  </div>
                  {nearingExpiry && (
                    <div style={{ color: 'var(--warning)', fontSize: '0.75rem', fontWeight: 600 }}>
                      {daysLeft} days until expiry
                    </div>
                  )}
                </div>

                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>Rent</div>
                  <div style={{ fontSize: '1.1rem', fontWeight: 600, color: 'var(--primary)' }}>{formatCurrency(Number(tenant.rent_amount))}</div>
                </div>

                <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  <Button variant="secondary" onClick={() => handleEdit(tenant)}>
                    <Pencil size={16} />
                  </Button>
                  <Button
                    variant="secondary"
                    onClick={() => setPendingAction({
                      title: tenant.is_active === false ? 'Activate Tenant' : 'Deactivate Tenant',
                      message: tenant.is_active === false
                        ? `Activate ${tenant.name} so they can access the tenant portal again?`
                        : `Deactivate ${tenant.name}? They will lose tenant portal access until reactivated.`,
                      confirmLabel: tenant.is_active === false ? 'Activate' : 'Deactivate',
                      tone: 'warning',
                      action: async () => {
                        await performToggleActivation(tenant);
                        setPendingAction(null);
                      },
                    })}
                    title={tenant.is_active === false ? 'Activate tenant' : 'Deactivate tenant'}
                  >
                    <Power size={16} color={tenant.is_active === false ? 'var(--success)' : 'var(--warning)'} />
                  </Button>
                  <Button variant="secondary" onClick={() => setPendingAction({
                    title: 'Delete Tenant',
                    message: `Delete ${tenant.name} and remove this booking record?`,
                    confirmLabel: 'Delete',
                    tone: 'danger',
                    action: async () => {
                      await performDelete(tenant.id, tenant.bed_id, tenant.name);
                      setPendingAction(null);
                    },
                  })}>
                    <Trash2 size={16} color="var(--danger)" />
                  </Button>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        message={pendingAction?.message ?? ''}
        confirmLabel={pendingAction?.confirmLabel}
        tone={pendingAction?.tone}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          await pendingAction.action();
        }}
      />
    </div>
  );
};
