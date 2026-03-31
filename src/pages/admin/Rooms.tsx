import { useCallback, useEffect, useState } from 'react';
import { BedDouble, Pencil, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { AdminAlertsData, fetchAdminAlerts, getCachedAdminAlerts } from '../../lib/adminAlerts';
import { invalidateAdminDataCache } from '../../lib/adminDataCache';
import { supabase } from '../../lib/supabase';

type Room = { id: string; name: string; property_id?: string };
type Bed = {
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

const INITIAL_BED_FORM = {
  bedNumber: '',
  rent: '',
};

export const Rooms = () => {
  const { selectedProperty, selectedPropertyId, isLoading: propertiesLoading, error: propertiesError } = useAdminProperty();
  const [rooms, setRooms] = useState<Room[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [tenantBookings, setTenantBookings] = useState<TenantBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [bedForm, setBedForm] = useState(INITIAL_BED_FORM);
  const [editingBedId, setEditingBedId] = useState<string | null>(null);
  const [bedFormError, setBedFormError] = useState('');
  const [alerts, setAlerts] = useState<AdminAlertsData>({ unpaidTenants: [], expiringTenants: [] });
  const [pendingAction, setPendingAction] = useState<null | {
    title: string;
    message: string;
    confirmLabel: string;
    action: () => Promise<void>;
  }>(null);

  useEffect(() => {
    const cachedAlerts = getCachedAdminAlerts(selectedPropertyId);
    if (cachedAlerts) {
      setAlerts(cachedAlerts);
    }

    fetchAdminAlerts(selectedPropertyId)
      .then(setAlerts)
      .catch((error) => console.error('Room alerts error:', error));
  }, [selectedPropertyId, tenantBookings]);

  const fetchData = useCallback(async () => {
    if (!selectedPropertyId) {
      setRooms([]);
      setBeds([]);
      setTenantBookings([]);
      setSelectedRoom(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    const [{ data: roomsData }, { data: bedsData }, { data: tenantsData }] = await Promise.all([
      supabase.from('rooms').select('*').eq('property_id', selectedPropertyId).order('name'),
      supabase.from('beds').select('*').eq('property_id', selectedPropertyId).order('bed_number'),
      supabase.from('tenants').select('id, name, bed_id, start_date, end_date, property_id').eq('property_id', selectedPropertyId).order('start_date', { ascending: false }),
    ]);

    if (roomsData) setRooms(roomsData);
    if (bedsData) setBeds(bedsData);
    if (tenantsData) setTenantBookings(tenantsData);
    if (selectedRoom && !roomsData?.some((room) => room.id === selectedRoom.id)) {
      setSelectedRoom(null);
      resetBedForm();
    }
    setLoading(false);
  }, [selectedPropertyId, selectedRoom]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const resetBedForm = () => {
    setBedForm(INITIAL_BED_FORM);
    setEditingBedId(null);
    setBedFormError('');
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName || !selectedPropertyId) return;

    const { data } = await supabase.from('rooms').insert([{ name: newRoomName, property_id: selectedPropertyId }]).select();
    if (data) setRooms([...rooms, ...data]);
    setNewRoomName('');
    invalidateAdminDataCache();
  };

  const handleDeleteRoom = async (id: string) => {
    await supabase.from('rooms').delete().match({ id });
    setRooms(rooms.filter((room) => room.id !== id));
    if (selectedRoom?.id === id) {
      setSelectedRoom(null);
      resetBedForm();
    }
    invalidateAdminDataCache();
  };

  const handleSaveBed = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!selectedRoom) return;
    if (!bedForm.bedNumber.trim()) {
      setBedFormError('Please enter a bed name or number.');
      return;
    }

    const parsedRent = Number(bedForm.rent);
    if (!bedForm.rent || Number.isNaN(parsedRent) || parsedRent < 0) {
      setBedFormError('Please enter a valid rent amount.');
      return;
    }

    setBedFormError('');

    if (editingBedId) {
      const { data } = await supabase
        .from('beds')
        .update({
          bed_number: bedForm.bedNumber.trim(),
          rent: parsedRent,
        })
        .eq('id', editingBedId)
        .select();

      if (data) {
        setBeds(beds.map((bed) => (bed.id === editingBedId ? data[0] : bed)));
      }
      invalidateAdminDataCache();
    } else {
      const { data } = await supabase.from('beds').insert([{
        room_id: selectedRoom.id,
        bed_number: bedForm.bedNumber.trim(),
        rent: parsedRent,
        status: 'vacant',
        property_id: selectedPropertyId,
      }]).select();

      if (data) setBeds([...beds, ...data]);
      invalidateAdminDataCache();
    }

    resetBedForm();
  };

  const handleStartEditBed = (bed: Bed) => {
    setEditingBedId(bed.id);
    setBedFormError('');
    setBedForm({
      bedNumber: bed.bed_number,
      rent: bed.rent?.toString() ?? '',
    });
  };

  const handleDeleteBed = async (id: string) => {
    await supabase.from('beds').delete().match({ id });
    setBeds(beds.filter((bed) => bed.id !== id));
    if (editingBedId === id) {
      resetBedForm();
    }
    invalidateAdminDataCache();
  };

  const selectedRoomBeds = selectedRoom
    ? beds.filter((bed) => bed.room_id === selectedRoom.id)
    : [];
  const today = format(new Date(), 'yyyy-MM-dd');

  const getCurrentTenant = (bedId: string) => tenantBookings.find((tenant) => (
    tenant.bed_id === bedId &&
    tenant.start_date <= today &&
    (!tenant.end_date || tenant.end_date >= today)
  ));

  const getNextBooking = (bedId: string) => tenantBookings
    .filter((tenant) => tenant.bed_id === bedId && tenant.start_date > today)
    .sort((left, right) => left.start_date.localeCompare(right.start_date))[0];

  if (loading) return <div className="page-container">Loading...</div>;

  if (propertiesLoading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading properties...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are loading your properties before opening the room inventory.</p>
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
            {propertiesError || 'Create your first property in Settings to start building rooms and beds.'}
          </p>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Rooms & Beds</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage the room and bed inventory for {selectedProperty?.name ?? 'the selected property'}.</p>
        </div>
      </div>

      {(alerts.unpaidTenants.length > 0 || alerts.expiringTenants.length > 0) && (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Alerts</h3>
          <p style={{ color: 'var(--text-secondary)' }}>
            {alerts.unpaidTenants.length > 0 ? `${alerts.unpaidTenants.length} tenant(s) are unpaid or partial this month. ` : ''}
            {alerts.expiringTenants.length > 0 ? `${alerts.expiringTenants.length} contract(s) expire within 7 days.` : ''}
          </p>
        </Card>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: '2rem' }}>
        <div>
          <Card style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginBottom: '1rem' }}>Add Room</h3>
            <form onSubmit={handleAddRoom} style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <Input
                placeholder="e.g. Room 101"
                value={newRoomName}
                onChange={(e) => setNewRoomName(e.target.value)}
                style={{ flex: 1, minWidth: '220px' }}
              />
              <Button type="submit"><Plus size={18} /></Button>
            </form>
          </Card>

          <Card style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
            <h3 style={{ marginBottom: '1rem' }}>All Rooms</h3>
            {rooms.length === 0 ? (
              <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>No rooms added yet.</p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {rooms.map((room) => (
                  <div
                    key={room.id}
                    onClick={() => {
                      setSelectedRoom(room);
                      resetBedForm();
                    }}
                    style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-sm)',
                      background: selectedRoom?.id === room.id ? 'var(--primary-glow)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${selectedRoom?.id === room.id ? 'var(--primary)' : 'var(--border-light)'}`,
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <span style={{ fontWeight: 500 }}>{room.name}</span>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingAction({
                          title: 'Delete Room',
                          message: `Delete ${room.name}? This will also remove the beds inside it.`,
                          confirmLabel: 'Delete',
                          action: async () => {
                            await handleDeleteRoom(room.id);
                            setPendingAction(null);
                          },
                        });
                      }}
                      style={{ color: 'var(--danger)', padding: '0.25rem' }}
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {selectedRoom ? (
          <div>
            <Card style={{ marginBottom: '1.5rem' }}>
              <h3 style={{ marginBottom: '1rem' }}>
                {editingBedId ? `Edit Bed in ${selectedRoom.name}` : `Add Bed to ${selectedRoom.name}`}
              </h3>
              <form onSubmit={handleSaveBed} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem', alignItems: 'end' }}>
                <Input
                  label="Bed Name"
                  placeholder="e.g. Bed A, Window Bed"
                  value={bedForm.bedNumber}
                  onChange={(e) => setBedForm({ ...bedForm, bedNumber: e.target.value })}
                />
                <Input
                  label="Rent"
                  type="number"
                  min="0"
                  step="0.01"
                  placeholder="e.g. 1200"
                  value={bedForm.rent}
                  onChange={(e) => setBedForm({ ...bedForm, rent: e.target.value })}
                />
                <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
                  <Button type="submit">{editingBedId ? 'Update Bed' : <><Plus size={18} /> Add Bed</>}</Button>
                  {editingBedId && (
                    <Button type="button" variant="secondary" onClick={resetBedForm}>
                      Cancel
                    </Button>
                  )}
                </div>
              </form>
              {bedFormError && (
                <div style={{ color: 'var(--danger)', fontSize: '0.875rem', marginTop: '0.75rem' }}>
                  {bedFormError}
                </div>
              )}
            </Card>

            <Card style={{ maxHeight: 'calc(100vh - 280px)', overflowY: 'auto' }}>
              <h3 style={{ marginBottom: '1rem' }}>Beds in {selectedRoom.name}</h3>
              {selectedRoomBeds.length === 0 ? (
                <p style={{ color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>No beds in this room.</p>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '1rem' }}>
                  {selectedRoomBeds.map((bed) => {
                    const currentTenant = getCurrentTenant(bed.id);
                    const nextBooking = getNextBooking(bed.id);
                    const isCurrentTenantUnpaid = currentTenant ? alerts.unpaidTenants.some((tenant) => tenant.id === currentTenant.id) : false;
                    const isCurrentTenantExpiring = currentTenant ? alerts.expiringTenants.some((tenant) => tenant.id === currentTenant.id) : false;

                    return (
                      <div
                        key={bed.id}
                        style={{
                          padding: '1.25rem',
                          borderRadius: 'var(--radius-md)',
                          background: isCurrentTenantUnpaid
                            ? 'rgba(127, 29, 29, 0.12)'
                            : isCurrentTenantExpiring
                              ? 'rgba(120, 53, 15, 0.12)'
                              : 'var(--bg-card-hover)',
                          border: editingBedId === bed.id
                            ? '1px solid var(--primary)'
                            : isCurrentTenantUnpaid
                              ? '1px solid rgba(239, 68, 68, 0.4)'
                              : isCurrentTenantExpiring
                                ? '1px solid rgba(245, 158, 11, 0.45)'
                                : '1px solid var(--border-light)',
                        }}
                      >
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <BedDouble size={20} color="var(--primary)" />
                          <span style={{ fontWeight: 500, fontSize: '1.1rem' }}>{bed.bed_number}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button onClick={() => handleStartEditBed(bed)} style={{ color: 'var(--secondary)', padding: '0.25rem' }}>
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => setPendingAction({
                            title: 'Delete Bed',
                            message: `Delete ${bed.bed_number} from ${selectedRoom.name}?`,
                            confirmLabel: 'Delete',
                            action: async () => {
                              await handleDeleteBed(bed.id);
                              setPendingAction(null);
                            },
                          })} style={{ color: 'var(--danger)', padding: '0.25rem' }}>
                            <Trash2 size={16} />
                          </button>
                        </div>
                            </div>

                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                        Rent: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>AED {Number(bed.rent ?? 0).toFixed(2)}</span>
                            </div>

                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.5rem' }}>
                              Current Tenant: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{currentTenant?.name || 'None'}</span>
                            </div>

                            {isCurrentTenantUnpaid && (
                              <div className="badge badge-danger" style={{ marginBottom: '0.5rem' }}>Unpaid Rent Alert</div>
                            )}
                            {isCurrentTenantExpiring && (
                              <div className="badge badge-warning" style={{ marginBottom: '0.5rem' }}>Contract Expiring Within 7 Days</div>
                            )}

                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                              Advance Booking: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                {nextBooking ? `${nextBooking.name} (${format(new Date(nextBooking.start_date), 'MMM dd, yyyy')})` : 'None'}
                              </span>
                            </div>

                            <div className={`badge ${bed.status === 'occupied' ? 'badge-warning' : 'badge-success'}`}>
                        {bed.status}
                            </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          </div>
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px dashed var(--border-light)',
              borderRadius: 'var(--radius-lg)',
              color: 'var(--text-tertiary)',
              height: '100%',
            }}
          >
            <p>Select a room to manage its beds</p>
          </div>
        )}
      </div>
      <ConfirmDialog
        open={pendingAction !== null}
        title={pendingAction?.title ?? ''}
        message={pendingAction?.message ?? ''}
        confirmLabel={pendingAction?.confirmLabel}
        tone="danger"
        onCancel={() => setPendingAction(null)}
        onConfirm={async () => {
          if (!pendingAction) return;
          await pendingAction.action();
        }}
      />
    </div>
  );
};
