import { AppRole } from './rbac';
import { supabase } from './supabase';

const dedupe = (values: string[]) => [...new Set(values.filter(Boolean))];

export const fetchTenantPropertyIds = async ({
  userId,
  email,
}: {
  userId: string;
  email?: string | null;
}) => {
  const propertyIds = new Set<string>();
  const queries = [
    supabase.from('tenants').select('property_id').eq('user_id', userId),
    email
      ? supabase.from('tenants').select('property_id').eq('email', email.toLowerCase())
      : null,
  ].filter(Boolean);

  for (const query of queries) {
    const response = await query;
    if (!response) continue;
    if (response.error) throw response.error;

    ((response.data ?? []) as Array<{ property_id?: string | null }>).forEach((row) => {
      if (row.property_id) {
        propertyIds.add(row.property_id);
      }
    });
  }

  return [...propertyIds];
};

export const replaceUserPropertyAssignments = async ({
  userId,
  propertyIds,
}: {
  userId: string;
  propertyIds: string[];
}) => {
  const { error: deleteError } = await supabase
    .from('user_properties')
    .delete()
    .eq('user_id', userId);

  if (deleteError && deleteError.code !== '42P01') {
    throw deleteError;
  }

  const nextPropertyIds = dedupe(propertyIds);
  if (nextPropertyIds.length === 0) return;

  const { error: insertError } = await supabase
    .from('user_properties')
    .insert(nextPropertyIds.map((propertyId) => ({
      user_id: userId,
      property_id: propertyId,
    })));

  if (insertError) throw insertError;
};

export const syncAssignmentsForRole = async ({
  userId,
  email,
  role,
  selectedPropertyIds,
}: {
  userId: string;
  email?: string | null;
  role: AppRole;
  selectedPropertyIds: string[];
}) => {
  if (role === 'owner' || role === 'manager') {
    await replaceUserPropertyAssignments({
      userId,
      propertyIds: selectedPropertyIds,
    });
    return;
  }

  if (role === 'tenant') {
    const tenantPropertyIds = await fetchTenantPropertyIds({
      userId,
      email,
    });
    await replaceUserPropertyAssignments({
      userId,
      propertyIds: [...tenantPropertyIds, ...selectedPropertyIds],
    });
    return;
  }

  await replaceUserPropertyAssignments({
    userId,
    propertyIds: [],
  });
};
