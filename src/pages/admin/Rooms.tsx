import { useEffect, useState } from 'react';
import { BedDouble, Pencil, Plus, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { supabase } from '../../lib/supabase';

type Room = { id: string; name: string };
type Bed = {
  id: string;
  room_id: string;
  bed_number: string;
  status: 'vacant' | 'occupied';
  rent: number | null;
};
type TenantBooking = {
  id: string;
  name: string;
  bed_id: string;
  start_date: string;
  end_date: string | null;
};

const INITIAL_BED_FORM = {
  bedNumber: '',
  rent: '',
};

export const Rooms = () => {
  const [rooms, setRooms] = useState<Room[]>([]);
  const [beds, setBeds] = useState<Bed[]>([]);
  const [tenantBookings, setTenantBookings] = useState<TenantBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [newRoomName, setNewRoomName] = useState('');
  const [selectedRoom, setSelectedRoom] = useState<Room | null>(null);
  const [bedForm, setBedForm] = useState(INITIAL_BED_FORM);
  const [editingBedId, setEditingBedId] = useState<string | null>(null);
  const [bedFormError, setBedFormError] = useState('');

  useEffect(() => {
    void fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    const [{ data: roomsData }, { data: bedsData }, { data: tenantsData }] = await Promise.all([
      supabase.from('rooms').select('*').order('name'),
      supabase.from('beds').select('*').order('bed_number'),
      supabase.from('tenants').select('id, name, bed_id, start_date, end_date').order('start_date', { ascending: false }),
    ]);

    if (roomsData) setRooms(roomsData);
    if (bedsData) setBeds(bedsData);
    if (tenantsData) setTenantBookings(tenantsData);
    setLoading(false);
  };

  const resetBedForm = () => {
    setBedForm(INITIAL_BED_FORM);
    setEditingBedId(null);
    setBedFormError('');
  };

  const handleAddRoom = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newRoomName) return;

    const { data } = await supabase.from('rooms').insert([{ name: newRoomName }]).select();
    if (data) setRooms([...rooms, ...data]);
    setNewRoomName('');
  };

  const handleDeleteRoom = async (id: string) => {
    if (!confirm('Are you sure you want to delete this room? It will delete all beds inside.')) return;
    await supabase.from('rooms').delete().match({ id });
    setRooms(rooms.filter((room) => room.id !== id));
    if (selectedRoom?.id === id) {
      setSelectedRoom(null);
      resetBedForm();
    }
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
    } else {
      const { data } = await supabase.from('beds').insert([{
        room_id: selectedRoom.id,
        bed_number: bedForm.bedNumber.trim(),
        rent: parsedRent,
        status: 'vacant',
      }]).select();

      if (data) setBeds([...beds, ...data]);
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
    if (!confirm('Are you sure you want to delete this bed?')) return;
    await supabase.from('beds').delete().match({ id });
    setBeds(beds.filter((bed) => bed.id !== id));
    if (editingBedId === id) {
      resetBedForm();
    }
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

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Rooms & Beds</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage your property inventory</p>
        </div>
      </div>

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
                        void handleDeleteRoom(room.id);
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
                  {selectedRoomBeds.map((bed) => (
                    <div
                      key={bed.id}
                      style={{
                        padding: '1.25rem',
                        borderRadius: 'var(--radius-md)',
                        background: 'var(--bg-card-hover)',
                        border: editingBedId === bed.id ? '1px solid var(--primary)' : '1px solid var(--border-light)',
                      }}
                    >
                      {(() => {
                        const currentTenant = getCurrentTenant(bed.id);
                        const nextBooking = getNextBooking(bed.id);

                        return (
                          <>
                            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1rem' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                          <BedDouble size={20} color="var(--primary)" />
                          <span style={{ fontWeight: 500, fontSize: '1.1rem' }}>{bed.bed_number}</span>
                        </div>
                        <div style={{ display: 'flex', gap: '0.25rem' }}>
                          <button onClick={() => handleStartEditBed(bed)} style={{ color: 'var(--secondary)', padding: '0.25rem' }}>
                            <Pencil size={16} />
                          </button>
                          <button onClick={() => void handleDeleteBed(bed.id)} style={{ color: 'var(--danger)', padding: '0.25rem' }}>
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

                            <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: '0.75rem' }}>
                              Advance Booking: <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>
                                {nextBooking ? `${nextBooking.name} (${format(new Date(nextBooking.start_date), 'MMM dd, yyyy')})` : 'None'}
                              </span>
                            </div>

                            <div className={`badge ${bed.status === 'occupied' ? 'badge-warning' : 'badge-success'}`}>
                        {bed.status}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  ))}
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
    </div>
  );
};
