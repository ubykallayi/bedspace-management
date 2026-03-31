import { format } from 'date-fns';
import { AppRole } from './rbac';
import { supabase } from './supabase';

export type BackupPayload = {
  version: number;
  generated_at: string;
  scope: 'global' | 'property';
  property_id: string | null;
  property_name?: string | null;
  restore_notes: string[];
  tables: {
    app_settings: unknown[];
    properties: unknown[];
    rooms: unknown[];
    beds: unknown[];
    tenants: unknown[];
    payments: unknown[];
    expenses: unknown[];
    users: unknown[];
    user_properties: unknown[];
    activity_logs: unknown[];
  };
};

const getBackupFilename = () => `backup-${format(new Date(), 'yyyy-MM-dd')}.json`;

export const buildBackupFileName = getBackupFilename;

const upsertRows = async (table: string, rows: unknown[]) => {
  if (!rows.length) return;
  const { error } = await supabase.from(table).upsert(rows);
  if (error) throw error;
};

export const restoreBackupPayload = async (payload: BackupPayload) => {
  if (!payload?.tables) {
    throw new Error('Invalid backup file.');
  }

  await upsertRows('app_settings', payload.tables.app_settings ?? []);
  await upsertRows('properties', payload.tables.properties ?? []);
  await upsertRows('rooms', payload.tables.rooms ?? []);
  await upsertRows('beds', payload.tables.beds ?? []);
  await upsertRows('tenants', payload.tables.tenants ?? []);
  await upsertRows('payments', payload.tables.payments ?? []);
  await upsertRows('expenses', payload.tables.expenses ?? []);
  await upsertRows('users', payload.tables.users ?? []);
  await upsertRows('user_properties', payload.tables.user_properties ?? []);
  await upsertRows('activity_logs', payload.tables.activity_logs ?? []);
};

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
  const propertyIds = isGlobalBackup
    ? []
    : [selectedPropertyId].filter(Boolean) as string[];

  const selectedUserIds = isGlobalBackup
    ? []
    : Array.from(new Set(((tenants ?? []) as Array<{ user_id?: string | null }>).map((tenant) => tenant.user_id).filter(Boolean))) as string[];
  const [
    { data: payments, error: paymentsError },
    { data: expenses, error: expensesError },
    { data: properties, error: propertiesError },
    { data: appSettings, error: appSettingsError },
    { data: users, error: usersError },
    { data: userProperties, error: userPropertiesError },
    { data: activityLogs, error: activityLogsError },
  ] = await Promise.all([
    tenantIds.length > 0
      ? supabase.from('payments').select('*').in('tenant_id', tenantIds).order('payment_date', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
    supabase.from('expenses').select('*').order('expense_date', { ascending: false }),
    isGlobalBackup
      ? supabase.from('properties').select('*').order('name')
      : supabase.from('properties').select('*').in('id', propertyIds).order('name'),
    supabase.from('app_settings').select('*').order('id'),
    isGlobalBackup
      ? supabase.from('users').select('id, email, role, is_active, created_at').order('email')
      : selectedUserIds.length > 0
        ? supabase.from('users').select('id, email, role, is_active, created_at').in('id', selectedUserIds).order('email')
        : Promise.resolve({ data: [], error: null }),
    isGlobalBackup
      ? supabase.from('user_properties').select('*').order('created_at', { ascending: false })
      : propertyIds.length > 0
        ? supabase.from('user_properties').select('*').in('property_id', propertyIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
    isGlobalBackup
      ? supabase.from('activity_logs').select('*').order('created_at', { ascending: false })
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (paymentsError) throw paymentsError;
  if (expensesError && expensesError.code !== '42P01') throw expensesError;
  if (propertiesError && propertiesError.code !== '42P01') throw propertiesError;
  if (appSettingsError && appSettingsError.code !== '42P01') throw appSettingsError;
  if (usersError && usersError.code !== '42P01' && usersError.code !== '42703') throw usersError;
  if (userPropertiesError && userPropertiesError.code !== '42P01') throw userPropertiesError;
  if (activityLogsError && activityLogsError.code !== '42P01') throw activityLogsError;

  const payload: BackupPayload = {
    version: 2,
    generated_at: new Date().toISOString(),
    scope: isGlobalBackup ? 'global' : 'property',
    property_id: isGlobalBackup ? null : selectedPropertyId,
    property_name: isGlobalBackup ? 'All Properties' : selectedPropertyName ?? null,
    restore_notes: [
      'This backup includes application data, property mappings, and app settings.',
      'Auth passwords and Google account tokens are not included and must be recreated separately if needed.',
      'For full restore, restore properties before rooms/beds, then tenants, then payments and expenses, then users and user_properties.',
    ],
    tables: {
      app_settings: appSettings ?? [],
      properties: properties ?? [],
      rooms: rooms ?? [],
      beds: beds ?? [],
      tenants: tenants ?? [],
      payments: payments ?? [],
      expenses: expenses ?? [],
      users: users ?? [],
      user_properties: userProperties ?? [],
      activity_logs: activityLogs ?? [],
    },
  };

  return payload;
};
