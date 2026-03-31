import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { isAdminRole } from '../lib/rbac';
import { supabase } from '../lib/supabase';
import { useAuth } from './AuthContext';

export type PropertyRecord = {
  id: string;
  name: string;
  location: string;
};

type AdminPropertyContextValue = {
  properties: PropertyRecord[];
  selectedPropertyId: string | null;
  selectedProperty: PropertyRecord | null;
  isLoading: boolean;
  error: string | null;
  refreshProperties: () => Promise<void>;
  selectProperty: (propertyId: string) => void;
  createProperty: (input: { name: string; location: string }) => Promise<{ error?: string; property?: PropertyRecord }>;
  updateProperty: (input: { id: string; name: string; location: string }) => Promise<{ error?: string; property?: PropertyRecord }>;
  deleteProperty: (propertyId: string) => Promise<{ error?: string }>;
};

const STORAGE_KEY = 'admin:selected-property-id';

const AdminPropertyContext = createContext<AdminPropertyContextValue>({
  properties: [],
  selectedPropertyId: null,
  selectedProperty: null,
  isLoading: true,
  error: null,
  refreshProperties: async () => {},
  selectProperty: () => {},
  createProperty: async () => ({}),
  updateProperty: async () => ({}),
  deleteProperty: async () => ({}),
});

export const AdminPropertyProvider = ({ children }: { children: React.ReactNode }) => {
  const { role, user } = useAuth();
  const [properties, setProperties] = useState<PropertyRecord[]>([]);
  const [selectedPropertyId, setSelectedPropertyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const persistSelection = (propertyId: string | null) => {
    setSelectedPropertyId(propertyId);

    if (typeof window === 'undefined') return;

    if (propertyId) {
      window.localStorage.setItem(STORAGE_KEY, propertyId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const refreshProperties = useCallback(async () => {
    if (!isAdminRole(role)) {
      setProperties([]);
      persistSelection(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setError(null);

    const propertiesQuery = role === 'super_admin'
      ? supabase
        .from('properties')
        .select('id, name, location')
        .order('name')
      : user?.id
        ? supabase
          .from('user_properties')
          .select('properties(id, name, location)')
          .eq('user_id', user.id)
        : null;

    if (!propertiesQuery) {
      setProperties([]);
      persistSelection(null);
      setError('No property assignments found for this account.');
      setIsLoading(false);
      return;
    }

    const { data, error: propertiesError } = await propertiesQuery;

    if (propertiesError) {
      console.error('Properties fetch error:', propertiesError);
      if (propertiesError.code === '42P01' || propertiesError.code === '42703') {
        setError('Properties table is not ready yet. Run the multi-property SQL first.');
      } else {
        setError(propertiesError.message || 'Unable to load properties.');
      }
      setProperties([]);
      persistSelection(null);
      setIsLoading(false);
      return;
    }

    const nextProperties = role === 'super_admin'
      ? (data ?? []) as PropertyRecord[]
      : ((data ?? []) as Array<{ properties: PropertyRecord | PropertyRecord[] | null }>)
        .flatMap((row) => Array.isArray(row.properties) ? row.properties : row.properties ? [row.properties] : []);
    setProperties(nextProperties);

    const storedPropertyId = typeof window !== 'undefined'
      ? window.localStorage.getItem(STORAGE_KEY)
      : null;
    const nextSelectedProperty = nextProperties.find((property) => property.id === selectedPropertyId)
      ?? nextProperties.find((property) => property.id === storedPropertyId)
      ?? nextProperties[0]
      ?? null;

    persistSelection(nextSelectedProperty?.id ?? null);
    setIsLoading(false);
  }, [role, selectedPropertyId, user?.id]);

  useEffect(() => {
    void refreshProperties();
  }, [refreshProperties]);

  const createProperty = useCallback(async ({ name, location }: { name: string; location: string }) => {
    const trimmedName = name.trim();
    const trimmedLocation = location.trim();

    if (!trimmedName) {
      return { error: 'Please enter a property name.' };
    }

    const { data, error: createError } = await supabase
      .from('properties')
      .insert([{ name: trimmedName, location: trimmedLocation }])
      .select('id, name, location')
      .single();

    if (createError) {
      console.error('Property create error:', createError);
      return { error: createError.message || 'Unable to create the property.' };
    }

    const nextProperty = data as PropertyRecord;
    const nextProperties = [...properties, nextProperty].sort((left, right) => left.name.localeCompare(right.name));
    setProperties(nextProperties);
    persistSelection(nextProperty.id);
    setError(null);
    return { property: nextProperty };
  }, [properties]);

  const updateProperty = useCallback(async ({
    id,
    name,
    location,
  }: {
    id: string;
    name: string;
    location: string;
  }) => {
    const trimmedName = name.trim();
    const trimmedLocation = location.trim();

    if (!trimmedName) {
      return { error: 'Please enter a property name.' };
    }

    const { data, error: updateError } = await supabase
      .from('properties')
      .update({
        name: trimmedName,
        location: trimmedLocation,
      })
      .eq('id', id)
      .select('id, name, location')
      .single();

    if (updateError) {
      console.error('Property update error:', updateError);
      return { error: updateError.message || 'Unable to update the property.' };
    }

    const nextProperty = data as PropertyRecord;
    setProperties((current) => current
      .map((property) => (property.id === id ? nextProperty : property))
      .sort((left, right) => left.name.localeCompare(right.name)));
    return { property: nextProperty };
  }, []);

  const deleteProperty = useCallback(async (propertyId: string) => {
    const { error: deleteError } = await supabase
      .from('properties')
      .delete()
      .eq('id', propertyId);

    if (deleteError) {
      console.error('Property delete error:', deleteError);
      return {
        error: deleteError.message || 'Unable to delete the property. Remove linked rooms, beds, and tenants first.',
      };
    }

    setProperties((current) => {
      const nextProperties = current.filter((property) => property.id !== propertyId);
      const nextSelected = nextProperties.find((property) => property.id === selectedPropertyId)
        ?? nextProperties[0]
        ?? null;
      persistSelection(nextSelected?.id ?? null);
      return nextProperties;
    });

    return {};
  }, [selectedPropertyId]);

  const value = useMemo(() => {
    const selectedProperty = properties.find((property) => property.id === selectedPropertyId) ?? null;

    return {
      properties,
      selectedPropertyId,
      selectedProperty,
      isLoading,
      error,
      refreshProperties,
      selectProperty: persistSelection,
      createProperty,
      updateProperty,
      deleteProperty,
    };
  }, [properties, selectedPropertyId, isLoading, error, refreshProperties, createProperty, updateProperty, deleteProperty]);

  return (
    <AdminPropertyContext.Provider value={value}>
      {children}
    </AdminPropertyContext.Provider>
  );
};

export const useAdminProperty = () => useContext(AdminPropertyContext);
