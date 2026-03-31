import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { format } from 'date-fns';
import { AlertCircle, BedDouble, Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { formatCurrency, writeActivityLog } from '../../lib/admin';
import { getCachedAdminData, invalidateAdminDataCache, setCachedAdminData } from '../../lib/adminDataCache';
import { AdminAlertsData, fetchAdminAlerts, getCachedAdminAlerts } from '../../lib/adminAlerts';
import { supabase } from '../../lib/supabase';

type RoomRecord = {
  id: string;
  name: string;
  property_id?: string;
};

type BedRecord = {
  id: string;
  room_id: string;
  bed_number: string;
  status: 'vacant' | 'occupied';
  rent: number | null;
  property_id?: string;
};

type TenantBooking = {
  id: string;
  name: string;
  bed_id: string;
  start_date: string;
  end_date: string | null;
  property_id?: string;
};

type PendingAction = {
  title: string;
  message: string;
  confirmLabel: string;
  tone: 'danger' | 'warning';
  action: () => Promise<void>;
};

const ROOMS_CACHE_KEY = 'rooms-page';

const emptyBedForm = {
  bedNumber: '',
  rent: '',
};

export const Rooms = () => {
  const { selectedProperty, selectedPropertyId, isLoading: propertiesLoading, error: propertiesError } = useAdminProperty();
  const [rooms, setRooms] = useState<RoomRecord[]>([]);
  const [beds, setBeds] = useState<BedRecord[]>([]);
  const [tenantBookings, setTenantBookings] = useState<TenantBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState('');
  const [showRoomForm, setShowRoomForm] = useState(false);
  const [showBedForm, setShowBedForm] = useState(false);
  const [newRoomName, setNewRoomName] = useState('');
  const [roomFormError, setRoomFormError] = useState('');
  const [bedForm, setBedForm] = useState(emptyBedForm);
  const [bedFormError, setBedFormError] = useState('');
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null);
  const [editingBedId, setEditingBedId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);
  const [alerts, setAlerts] = useState<AdminAlertsData>({ unpaidTenants: [], expiringTenants: [] });
  const roomFormRef = useRef<HTMLDivElement | null>(null);
  const bedFormRef = useRef<HTMLDivElement | null>(null);

  const fetchData = useCallback(async () => {
    if (!selectedPropertyId) {
      setRooms([]);
      setBeds([]);
      setTenantBookings([]);
      setLoading(false);
      setFetchError('');
      return;
    }

    const cacheKey = `${ROOMS_CACHE_KEY}:${selectedPropertyId}`;
    const cached = getCachedAdminData<{
      rooms: RoomRecord[];
      beds: BedRecord[];
      tenantBookings: TenantBooking[];
    }>(cacheKey);

    if (cached) {
      setRooms(cached.rooms);
      setBeds(cached.beds);
      setTenantBookings(cached.tenantBookings);
      setSelectedRoomId((current) => current ?? cached.rooms[0]?.id ?? null);
      setLoading(false);
    } else {
      setLoading(true);
    }

    setFetchError('');

    const [
      { data: roomRows, error: roomsError },
      { data: bedRows, error: bedsError },
      { data: tenantRows, error: tenantsError },
    ] = await Promise.all([
      supabase.from('rooms').select('id, name, property_id').eq('property_id', selectedPropertyId).order('name'),
      supabase.from('beds').select('id, room_id, bed_number, status, rent, property_id').eq('property_id', selectedPropertyId).order('bed_number'),
      supabase.from('tenants').select('id, name, bed_id, start_date, end_date, property_id').eq('property_id', selectedPropertyId).order('start_date', { ascending: false }),
    ]);

    if (roomsError || bedsError || tenantsError) {
      const message = roomsError?.message || bedsError?.message || tenantsError?.message || 'Unable to load rooms and beds.';
      setFetchError(message);
      setLoading(false);
      return;
    }

    const safeRooms = (roomRows ?? []) as RoomRecord[];
    const safeBeds = (bedRows ?? []) as BedRecord[];
    const safeTenantBookings = (tenantRows ?? []) as TenantBooking[];

    setRooms(safeRooms);
    setBeds(safeBeds);
    setTenantBookings(safeTenantBookings);
    setSelectedRoomId((current) => (
      current && safeRooms.some((room) => room.id === current)
        ? current
        : safeRooms[0]?.id ?? null
    ));
    setCachedAdminData(cacheKey, {
      rooms: safeRooms,
      beds: safeBeds,
      tenantBookings: safeTenantBookings,
    });
    setLoading(false);
  }, [selectedPropertyId]);

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
      .catch((error: { message?: string }) => {
        console.error('Rooms alerts error:', error);
      });
  }, [selectedPropertyId]);

  useEffect(() => {
    if (showRoomForm) {
      roomFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showRoomForm]);

  useEffect(() => {
    if (showBedForm) {
      bedFormRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [showBedForm]);

  const resetBedForm = () => {
    setBedForm(emptyBedForm);
    setBedFormError('');
    setEditingBedId(null);
  };

  const resetRoomForm = () => {
    setNewRoomName('');
    setRoomFormError('');
  };

  const selectedRoom = useMemo(
    () => rooms.find((room) => room.id === selectedRoomId) ?? null,
    [rooms, selectedRoomId],
  );

  const bedsForSelectedRoom = useMemo(
    () => beds.filter((bed) => bed.room_id === selectedRoomId),
    [beds, selectedRoomId],
  );

  const bedRows = useMemo(() => {
    const todayKey = format(new Date(), 'yyyy-MM-dd');

    return beds.map((bed) => {
      const room = rooms.find((item) => item.id === bed.room_id) ?? null;
      const bookings = tenantBookings
        .filter((tenant) => tenant.bed_id === bed.id)
        .sort((left, right) => left.start_date.localeCompare(right.start_date));
      const currentTenant = bookings.find((tenant) => (
        tenant.start_date <= todayKey &&
        (!tenant.end_date || tenant.end_date >= todayKey)
      )) ?? null;
      const nextBooking = bookings.find((tenant) => tenant.start_date > todayKey) ?? null;

      return {
        ...bed,
        room,
        currentTenant,
        nextBooking,
      };
    }).sort((left, right) => {
      const roomCompare = (left.room?.name ?? '').localeCompare(right.room?.name ?? '');
      if (roomCompare !== 0) return roomCompare;
      return left.bed_number.localeCompare(right.bed_number, undefined, { numeric: true, sensitivity: 'base' });
    });
  }, [beds, rooms, tenantBookings]);

  const summary = useMemo(() => {
    const occupied = beds.filter((bed) => bed.status === 'occupied').length;
    return {
      rooms: rooms.length,
      totalBeds: beds.length,
      occupiedBeds: occupied,
      vacantBeds: beds.length - occupied,
    };
  }, [beds, rooms.length]);

  const handleAddRoom = async () => {
    if (!selectedPropertyId) {
      setRoomFormError('Select a property first.');
      return;
    }

    const trimmedName = newRoomName.trim();
    if (!trimmedName) {
      setRoomFormError('Enter a room name or number.');
      return;
    }

    setRoomFormError('');
    const { data, error } = await supabase
      .from('rooms')
      .insert([{ name: trimmedName, property_id: selectedPropertyId }])
      .select('id, name, property_id')
      .single();

    if (error) {
      setRoomFormError(error.message || 'Unable to add room.');
      return;
    }

    await writeActivityLog({
      action: 'create',
      entityType: 'room',
      entityId: data.id,
      description: `Created room ${trimmedName}.`,
    });

    invalidateAdminDataCache('rooms-page');
    invalidateAdminDataCache('admin-dashboard');
    invalidateAdminDataCache('admin-alerts');
    await fetchData();
    resetRoomForm();
    setShowRoomForm(false);
    setSelectedRoomId(data.id);
  };

  const handleSaveBed = async () => {
    if (!selectedPropertyId) {
      setBedFormError('Select a property first.');
      return;
    }

    if (!selectedRoomId) {
      setBedFormError('Choose a room before saving a bed.');
      return;
    }

    const trimmedBedNumber = bedForm.bedNumber.trim();
    if (!trimmedBedNumber) {
      setBedFormError('Enter a bed number.');
      return;
    }

    const parsedRent = Number(bedForm.rent);
    if (!Number.isFinite(parsedRent) || parsedRent < 0) {
      setBedFormError('Enter a valid rent amount.');
      return;
    }

    const duplicateBed = beds.find((bed) => (
      bed.room_id === selectedRoomId &&
      bed.id !== editingBedId &&
      bed.bed_number.trim().toLowerCase() === trimmedBedNumber.toLowerCase()
    ));

    if (duplicateBed) {
      setBedFormError('This bed number already exists in the selected room.');
      return;
    }

    setBedFormError('');

    if (editingBedId) {
      const { error } = await supabase
        .from('beds')
        .update({
          bed_number: trimmedBedNumber,
          rent: parsedRent,
          room_id: selectedRoomId,
          property_id: selectedPropertyId,
        })
        .eq('id', editingBedId);

      if (error) {
        setBedFormError(error.message || 'Unable to update bed.');
        return;
      }

      await writeActivityLog({
        action: 'update',
        entityType: 'bed',
        entityId: editingBedId,
        description: `Updated bed ${trimmedBedNumber}.`,
      });
    } else {
      const { data, error } = await supabase
        .from('beds')
        .insert([{
          room_id: selectedRoomId,
          bed_number: trimmedBedNumber,
          status: 'vacant',
          rent: parsedRent,
          property_id: selectedPropertyId,
        }])
        .select('id')
        .single();

      if (error) {
        setBedFormError(error.message || 'Unable to add bed.');
        return;
      }

      await writeActivityLog({
        action: 'create',
        entityType: 'bed',
        entityId: data.id,
        description: `Created bed ${trimmedBedNumber}.`,
      });
    }

    invalidateAdminDataCache('rooms-page');
    invalidateAdminDataCache('admin-dashboard');
    invalidateAdminDataCache('admin-alerts');
    await fetchData();
    resetBedForm();
    setShowBedForm(false);
  };

  const handleStartEditBed = (bed: BedRecord) => {
    setSelectedRoomId(bed.room_id);
    setBedForm({
      bedNumber: bed.bed_number,
      rent: bed.rent != null ? String(bed.rent) : '',
    });
    setEditingBedId(bed.id);
    setBedFormError('');
    setShowBedForm(true);
  };

  const handleDeleteRoom = (room: RoomRecord) => {
    setPendingAction({
      title: 'Delete room?',
      message: `Delete ${room.name}? Remove its linked beds and tenant assignments first if the database blocks the action.`,
      confirmLabel: 'Delete room',
      tone: 'danger',
      action: async () => {
        const { error } = await supabase.from('rooms').delete().eq('id', room.id);

        if (error) {
          setFetchError(error.message || 'Unable to delete room.');
          return;
        }

        await writeActivityLog({
          action: 'delete',
          entityType: 'room',
          entityId: room.id,
          description: `Deleted room ${room.name}.`,
        });

        invalidateAdminDataCache('rooms-page');
        invalidateAdminDataCache('admin-dashboard');
        invalidateAdminDataCache('admin-alerts');
        await fetchData();
      },
    });
  };

  const handleDeleteBed = (bed: BedRecord) => {
    setPendingAction({
      title: 'Delete bed?',
      message: `Delete bed ${bed.bed_number}? This should only be done when it no longer has active tenant usage.`,
      confirmLabel: 'Delete bed',
      tone: 'danger',
      action: async () => {
        const { error } = await supabase.from('beds').delete().eq('id', bed.id);

        if (error) {
          setFetchError(error.message || 'Unable to delete bed.');
          return;
        }

        await writeActivityLog({
          action: 'delete',
          entityType: 'bed',
          entityId: bed.id,
          description: `Deleted bed ${bed.bed_number}.`,
        });

        invalidateAdminDataCache('rooms-page');
        invalidateAdminDataCache('admin-dashboard');
        invalidateAdminDataCache('admin-alerts');
        await fetchData();
      },
    });
  };

  const renderBookingText = (booking: TenantBooking | null) => {
    if (!booking) return 'None';
    return booking.end_date
      ? `${booking.name} · until ${format(new Date(booking.end_date), 'MMM dd, yyyy')}`
      : `${booking.name} · ongoing`;
  };

  if (loading || propertiesLoading) {
    return (
      <div className="page-container">
        <div style={{ color: 'var(--text-secondary)' }}>Loading rooms and beds...</div>
      </div>
    );
  }

  if (propertiesError) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.75rem' }}>Rooms & Beds</h2>
          <p style={{ color: 'var(--danger)' }}>{propertiesError}</p>
        </Card>
      </div>
    );
  }

  if (!selectedPropertyId) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.75rem' }}>Rooms & Beds</h2>
          <p style={{ color: 'var(--text-secondary)' }}>Create or select a property first to manage rooms and beds.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">Rooms & Beds</h1>
          <p style={{ color: 'var(--text-secondary)', marginTop: '0.35rem' }}>
            {selectedProperty ? `${selectedProperty.name} inventory` : 'Property inventory'}
          </p>
        </div>
        <div className="admin-toolbar">
          <Button
            variant={showRoomForm ? 'secondary' : 'primary'}
            onClick={() => {
              setShowRoomForm((current) => !current);
              if (showRoomForm) resetRoomForm();
            }}
          >
            <Plus size={16} />
            {showRoomForm ? 'Close Room Form' : 'Add Room'}
          </Button>
          <Button
            variant={showBedForm ? 'secondary' : 'primary'}
            onClick={() => {
              if (!selectedRoomId) {
                setFetchError('Choose a room first, then add a bed.');
                return;
              }
              setShowBedForm((current) => !current);
              if (showBedForm) resetBedForm();
            }}
          >
            <Plus size={16} />
            {showBedForm ? 'Close Bed Form' : 'Add Bed'}
          </Button>
        </div>
      </div>

      {fetchError ? (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(239, 68, 68, 0.4)' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
            <AlertCircle size={18} style={{ color: 'var(--danger)', flexShrink: 0, marginTop: '0.1rem' }} />
            <p style={{ color: 'var(--danger)' }}>{fetchError}</p>
          </div>
        </Card>
      ) : null}

      {(alerts.unpaidTenants.length > 0 || alerts.expiringTenants.length > 0) ? (
        <Card style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
            <div>
              <h3 style={{ marginBottom: '0.35rem' }}>Attention Needed</h3>
              <p style={{ color: 'var(--text-secondary)' }}>Highlighted bookings also appear inside the bed list below.</p>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span className="badge badge-danger">{alerts.unpaidTenants.length} Unpaid</span>
              <span className="badge badge-warning">{alerts.expiringTenants.length} Expiring Soon</span>
            </div>
          </div>
        </Card>
      ) : null}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))',
        gap: '1rem',
        marginBottom: '1.5rem',
      }}>
        {[
          { label: 'Rooms', value: summary.rooms },
          { label: 'Beds', value: summary.totalBeds },
          { label: 'Occupied', value: summary.occupiedBeds },
          { label: 'Vacant', value: summary.vacantBeds },
        ].map((item) => (
          <Card key={item.label}>
            <div style={{ color: 'var(--text-secondary)', fontSize: '0.9rem', marginBottom: '0.5rem' }}>{item.label}</div>
            <div style={{ fontSize: '2rem', fontWeight: 700 }}>{item.value}</div>
          </Card>
        ))}
      </div>

      {showRoomForm ? (
        <Card ref={roomFormRef} style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <h3>Add Room</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Keep room setup short and simple. Beds can be added next.</p>
            </div>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(220px, 1fr) auto', gap: '1rem', alignItems: 'end' }}>
            <Input
              label="Room Name / Number"
              placeholder="e.g. Room 101"
              value={newRoomName}
              onChange={(event) => setNewRoomName(event.target.value)}
              error={roomFormError}
            />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => { resetRoomForm(); setShowRoomForm(false); }}>
                Cancel
              </Button>
              <Button onClick={() => void handleAddRoom()}>
                Save Room
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {showBedForm ? (
        <Card ref={bedFormRef} style={{ marginBottom: '1.5rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <h3>{editingBedId ? 'Edit Bed' : 'Add Bed'}</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                {selectedRoom ? `Saving inside ${selectedRoom.name}.` : 'Select a room first.'}
              </p>
            </div>
            {selectedRoom ? (
              <span className="badge badge-success">{selectedRoom.name}</span>
            ) : null}
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
            gap: '1rem',
            alignItems: 'end',
          }}>
            <div className="form-group">
              <label className="form-label">Room</label>
              <select
                className="form-select"
                value={selectedRoomId ?? ''}
                onChange={(event) => setSelectedRoomId(event.target.value || null)}
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>{room.name}</option>
                ))}
              </select>
            </div>
            <Input
              label="Bed Number"
              placeholder="e.g. Bed A"
              value={bedForm.bedNumber}
              onChange={(event) => setBedForm((current) => ({ ...current, bedNumber: event.target.value }))}
            />
            <Input
              label="Monthly Rent"
              type="number"
              min="0"
              step="0.01"
              placeholder="0.00"
              value={bedForm.rent}
              onChange={(event) => setBedForm((current) => ({ ...current, rent: event.target.value }))}
              error={bedFormError}
            />
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <Button variant="secondary" onClick={() => { resetBedForm(); setShowBedForm(false); }}>
                Cancel
              </Button>
              <Button onClick={() => void handleSaveBed()}>
                {editingBedId ? 'Update Bed' : 'Save Bed'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '1.5rem',
        marginBottom: '1.5rem',
      }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', marginBottom: '1rem', alignItems: 'center' }}>
            <div>
              <h3>Rooms</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Choose a room to focus its beds.</p>
            </div>
            <span className="badge badge-success">{rooms.length}</span>
          </div>

          {rooms.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)' }}>No rooms yet. Click `Add Room` to start.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {rooms.map((room) => {
                const roomBeds = beds.filter((bed) => bed.room_id === room.id);
                return (
                  <div
                    key={room.id}
                    onClick={() => setSelectedRoomId(room.id)}
                    style={{
                      textAlign: 'left',
                      padding: '1rem',
                      borderRadius: '12px',
                      border: selectedRoomId === room.id ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                      background: selectedRoomId === room.id ? 'rgba(123, 97, 255, 0.12)' : 'rgba(255,255,255,0.02)',
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'flex-start' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{room.name}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginTop: '0.25rem' }}>
                          {roomBeds.length} beds
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          handleDeleteRoom(room);
                        }}
                        style={{ color: 'var(--danger)', display: 'inline-flex' }}
                        aria-label={`Delete ${room.name}`}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <h3>{selectedRoom ? `${selectedRoom.name} Beds` : 'Beds'}</h3>
              <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>
                Quick view for the selected room, with edit actions close to the data.
              </p>
            </div>
            {selectedRoom ? (
              <Button variant="secondary" onClick={() => setShowBedForm(true)}>
                <Plus size={16} />
                Add Bed Here
              </Button>
            ) : null}
          </div>

          {!selectedRoom ? (
            <div style={{ color: 'var(--text-secondary)' }}>Select a room to view its beds.</div>
          ) : bedsForSelectedRoom.length === 0 ? (
            <div style={{ color: 'var(--text-secondary)' }}>No beds in this room yet. Click `Add Bed` to create one.</div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1rem',
            }}>
              {bedsForSelectedRoom.map((bed) => {
                const row = bedRows.find((item) => item.id === bed.id);
                const isAttention = alerts.unpaidTenants.some((item) => item.id === row?.currentTenant?.id)
                  || alerts.expiringTenants.some((item) => item.id === row?.currentTenant?.id);

                return (
                  <div
                    key={bed.id}
                    style={{
                      border: `1px solid ${isAttention ? 'rgba(245, 158, 11, 0.45)' : 'var(--border-light)'}`,
                      borderRadius: '14px',
                      padding: '1rem',
                      background: isAttention ? 'rgba(245, 158, 11, 0.08)' : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.9rem' }}>
                      <div style={{ display: 'flex', gap: '0.65rem', alignItems: 'center' }}>
                        <div style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '12px',
                          background: 'rgba(14, 165, 233, 0.12)',
                          color: 'var(--secondary)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                        }}>
                          <BedDouble size={18} />
                        </div>
                        <div>
                          <div style={{ fontWeight: 600 }}>{bed.bed_number}</div>
                          <span className={`badge ${bed.status === 'vacant' ? 'badge-success' : 'badge-warning'}`}>
                            {bed.status}
                          </span>
                        </div>
                      </div>
                      <div style={{ display: 'flex', gap: '0.5rem' }}>
                        <button type="button" onClick={() => handleStartEditBed(bed)} aria-label={`Edit ${bed.bed_number}`}>
                          <Pencil size={16} style={{ color: 'var(--text-secondary)' }} />
                        </button>
                        <button type="button" onClick={() => handleDeleteBed(bed)} aria-label={`Delete ${bed.bed_number}`}>
                          <Trash2 size={16} style={{ color: 'var(--danger)' }} />
                        </button>
                      </div>
                    </div>
                    <div style={{ display: 'grid', gap: '0.5rem', color: 'var(--text-secondary)', fontSize: '0.9rem' }}>
                      <div>Rent: <span style={{ color: 'var(--text-primary)' }}>{formatCurrency(Number(bed.rent ?? 0))}</span></div>
                      <div>Current: <span style={{ color: 'var(--text-primary)' }}>{row?.currentTenant?.name ?? 'Vacant'}</span></div>
                      <div>Upcoming: <span style={{ color: 'var(--text-primary)' }}>{row?.nextBooking ? renderBookingText(row.nextBooking) : 'None'}</span></div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <div>
            <h3>All Beds</h3>
            <p style={{ color: 'var(--text-secondary)', marginTop: '0.25rem' }}>Full bed inventory for {selectedProperty?.name ?? 'this property'}.</p>
          </div>
          <span className="badge badge-success">{bedRows.length} visible</span>
        </div>

        {bedRows.length === 0 ? (
          <div style={{ color: 'var(--text-secondary)' }}>No beds found for this property yet.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <div className="data-grid-header" style={{
              gridTemplateColumns: 'minmax(120px, 1fr) minmax(100px, 0.8fr) minmax(100px, 0.8fr) minmax(120px, 0.9fr) minmax(180px, 1.4fr) minmax(180px, 1.4fr) auto',
              padding: '0 0.75rem 0.75rem',
              color: 'var(--text-secondary)',
              fontSize: '0.8rem',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              minWidth: '960px',
            }}>
              <div>Room</div>
              <div>Bed</div>
              <div>Status</div>
              <div>Rent</div>
              <div>Current Tenant</div>
              <div>Advance Booking</div>
              <div style={{ textAlign: 'right' }}>Actions</div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', minWidth: '960px' }}>
              {bedRows.map((row) => {
                const isUnpaid = row.currentTenant && alerts.unpaidTenants.some((item) => item.id === row.currentTenant?.id);
                const isExpiring = row.currentTenant && alerts.expiringTenants.some((item) => item.id === row.currentTenant?.id);

                return (
                  <div
                    key={row.id}
                    className="data-grid-row"
                    style={{
                      gridTemplateColumns: 'minmax(120px, 1fr) minmax(100px, 0.8fr) minmax(100px, 0.8fr) minmax(120px, 0.9fr) minmax(180px, 1.4fr) minmax(180px, 1.4fr) auto',
                      padding: '1rem 0.75rem',
                      borderRadius: '14px',
                      border: '1px solid var(--border-light)',
                      background: isUnpaid
                        ? 'rgba(239, 68, 68, 0.08)'
                        : isExpiring
                          ? 'rgba(245, 158, 11, 0.08)'
                          : 'rgba(255,255,255,0.02)',
                    }}
                  >
                    <div style={{ fontWeight: 600 }}>{row.room?.name ?? 'Unknown room'}</div>
                    <div>{row.bed_number}</div>
                    <div>
                      <span className={`badge ${row.status === 'vacant' ? 'badge-success' : 'badge-warning'}`}>
                        {row.status}
                      </span>
                    </div>
                    <div>{formatCurrency(Number(row.rent ?? 0))}</div>
                    <div>
                      <div>{row.currentTenant?.name ?? 'Vacant'}</div>
                      {isUnpaid ? <div style={{ color: 'var(--danger)', fontSize: '0.8rem', marginTop: '0.2rem' }}>Rent unpaid</div> : null}
                      {isExpiring && row.currentTenant?.end_date ? (
                        <div style={{ color: 'var(--warning)', fontSize: '0.8rem', marginTop: '0.2rem' }}>
                          Ends {format(new Date(row.currentTenant.end_date), 'MMM dd, yyyy')}
                        </div>
                      ) : null}
                    </div>
                    <div>{row.nextBooking ? renderBookingText(row.nextBooking) : 'None'}</div>
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                      <button type="button" onClick={() => handleStartEditBed(row)} aria-label={`Edit ${row.bed_number}`}>
                        <Pencil size={16} style={{ color: 'var(--text-secondary)' }} />
                      </button>
                      <button type="button" onClick={() => handleDeleteBed(row)} aria-label={`Delete ${row.bed_number}`}>
                        <Trash2 size={16} style={{ color: 'var(--danger)' }} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </Card>

      <ConfirmDialog
        open={Boolean(pendingAction)}
        title={pendingAction?.title ?? ''}
        message={pendingAction?.message ?? ''}
        confirmLabel={pendingAction?.confirmLabel ?? 'Confirm'}
        tone={pendingAction?.tone ?? 'danger'}
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          await pendingAction.action();
          setPendingAction(null);
        }}
      />
    </div>
  );
};
