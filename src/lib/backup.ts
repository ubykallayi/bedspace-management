import { format } from 'date-fns';
import { AppRole } from './rbac';
import { supabase } from './supabase';

type BackupPayload = {
  generated_at: string;
  scope: 'global' | 'property';
  property_id: string | null;
  property_name?: string | null;
  tables: {
    rooms: unknown[];
    beds: unknown[];
    tenants: unknown[];
    payments: unknown[];
    expenses: unknown[];
  };
};

const getBackupFilename = () => `backup-${format(new Date(), 'yyyy-MM-dd')}.json`;

export const buildBackupFileName = getBackupFilename;

export const fetchBackupPayload = async ({
  role,
  selectedPropertyId,
  selectedPropertyName,
}: {
  role: AppRole;
  selectedPropertyId: string | null;
  selectedPropertyName?: string | null;
}) => {
  const isGlobalBackup = role === 'super_admin';

  const roomsQuery = isGlobalBackup
    ? supabase.from('rooms').select('*').order('name')
    : supabase.from('rooms').select('*').eq('property_id', selectedPropertyId).order('name');
  const bedsQuery = isGlobalBackup
    ? supabase.from('beds').select('*').order('bed_number')
    : supabase.from('beds').select('*').eq('property_id', selectedPropertyId).order('bed_number');
  const tenantsQuery = isGlobalBackup
    ? supabase.from('tenants').select('*').order('start_date', { ascending: false })
    : supabase.from('tenants').select('*').eq('property_id', selectedPropertyId).order('start_date', { ascending: false });

  const [
    { data: rooms, error: roomsError },
    { data: beds, error: bedsError },
    { data: tenants, error: tenantsError },
  ] = await Promise.all([roomsQuery, bedsQuery, tenantsQuery]);

  if (roomsError) throw roomsError;
  if (bedsError) throw bedsError;
  if (tenantsError) throw tenantsError;

  const tenantIds = ((tenants ?? []) as Array<{ id: string }>).map((tenant) => tenant.id);
  const [
    { data: payments, error: paymentsError },
    { data: expenses, error: expensesError },
  ] = await Promise.all([
    tenantIds.length > 0
      ? supabase.from('payments').select('*').in('tenant_id', tenantIds).order('payment_date', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
  ]);

  if (paymentsError) throw paymentsError;
  if (expensesError && expensesError.code !== '42P01') throw expensesError;

  const payload: BackupPayload = {
    generated_at: new Date().toISOString(),
    scope: isGlobalBackup ? 'global' : 'property',
    property_id: isGlobalBackup ? null : selectedPropertyId,
    property_name: isGlobalBackup ? 'All Properties' : selectedPropertyName ?? null,
    tables: {
      rooms: rooms ?? [],
      beds: beds ?? [],
      tenants: tenants ?? [],
      payments: payments ?? [],
      expenses: expenses ?? [],
    },
  };

  return payload;
};
