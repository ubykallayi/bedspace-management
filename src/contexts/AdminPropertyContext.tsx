import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { isAdminRole } from '../lib/rbac';
import { supabase, withSupabaseTimeout } from '../lib/supabase';
import { useAuth } from './AuthContext';

export type PropertyRecord = {
  id: string;
  name: string;
  location: string;
  theme_color?: string | null;
};

type AdminPropertyContextValue = {
  properties: PropertyRecord[];
  selectedPropertyId: string | null;
  selectedProperty: PropertyRecord | null;
  isLoading: boolean;
  error: string | null;
  refreshProperties: () => Promise<void>;
  selectProperty: (propertyId: string) => void;
  createProperty: (input: { name: string; location: string; theme_color?: string }) => Promise<{ error?: string; property?: PropertyRecord }>;
  updateProperty: (input: { id: string; name: string; location: string; theme_color?: string }) => Promise<{ error?: string; property?: PropertyRecord }>;
  deleteProperty: (propertyId: string) => Promise<{ error?: string }>;
};

const STORAGE_KEY = 'admin:selected-property-id';
const FOCUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
const DEFAULT_THEME = {
  primary: '#7b61ff',
  primaryHover: '#9c89ff',
  primaryGlow: 'rgba(123, 97, 255, 0.3)',
  borderFocus: 'rgba(123, 97, 255, 0.5)',
};

const hexToRgb = (hex: string) => {
  const normalized = hex.replace('#', '');
  if (normalized.length !== 6) return null;

  const value = Number.parseInt(normalized, 16);
  if (Number.isNaN(value)) return null;

  return {
    r: (value >> 16) & 255,
    g: (value >> 8) & 255,
    b: value & 255,
  };
};

const shadeHex = (hex: string, percent: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return DEFAULT_THEME.primaryHover;

  const adjustChannel = (channel: number) => Math.max(0, Math.min(255, Math.round(channel + (255 - channel) * percent)));
  return `#${[adjustChannel(rgb.r), adjustChannel(rgb.g), adjustChannel(rgb.b)]
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('')}`;
};

const rgbaFromHex = (hex: string, alpha: number) => {
  const rgb = hexToRgb(hex);
  if (!rgb) return DEFAULT_THEME.primaryGlow;
  return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
};

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
  const refreshRequestRef = useRef(0);
  const lastRefreshAtRef = useRef(0);

  const persistSelection = (propertyId: string | null) => {
    setSelectedPropertyId(propertyId);

    if (typeof window === 'undefined') return;

    if (propertyId) {
      window.localStorage.setItem(STORAGE_KEY, propertyId);
    } else {
      window.localStorage.removeItem(STORAGE_KEY);
    }
  };

  const refreshPropertiesInternal = useCallback(async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = ++refreshRequestRef.current;

    if (!isAdminRole(role)) {
      setProperties([]);
      persistSelection(null);
      setError(null);
      setIsLoading(false);
      return;
    }

    if (!silent || lastRefreshAtRef.current === 0) {
      setIsLoading(true);
    }
    if (!silent) {
      setError(null);
    }

    try {
      if (role !== 'super_admin' && !user?.id) {
        setProperties([]);
        persistSelection(null);
        setError('No property assignments found for this account.');
        return;
      }

      let nextProperties: PropertyRecord[] = [];

      if (role === 'super_admin') {
        const { data, error: propertiesError } = await withSupabaseTimeout(
          supabase
            .from('properties')
            .select('id, name, location, theme_color')
            .order('name'),
          'Properties took too long to load. Please try again.',
        );
        if (requestId !== refreshRequestRef.current) return;

        if (propertiesError) {
          console.error('Properties fetch error:', propertiesError);
          if (propertiesError.code === '42P01' || propertiesError.code === '42703') {
            setError('Properties table is not ready yet. Run the multi-property SQL first.');
          } else {
            setError(propertiesError.message || 'Unable to load properties.');
          }
          setProperties([]);
          persistSelection(null);
          return;
        }

        nextProperties = (data ?? []) as PropertyRecord[];
      } else {
        const { data, error: propertiesError } = await withSupabaseTimeout(
          supabase
            .from('user_properties')
            .select('properties(id, name, location, theme_color)')
            .eq('user_id', user!.id),
          'Properties took too long to load. Please try again.',
        );
        if (requestId !== refreshRequestRef.current) return;

        if (propertiesError) {
          console.error('Properties fetch error:', propertiesError);
          if (propertiesError.code === '42P01' || propertiesError.code === '42703') {
            setError('Properties table is not ready yet. Run the multi-property SQL first.');
          } else {
            setError(propertiesError.message || 'Unable to load properties.');
          }
          setProperties([]);
          persistSelection(null);
          return;
        }

        nextProperties = ((data ?? []) as Array<{ properties: PropertyRecord | PropertyRecord[] | null }>)
          .flatMap((row) => Array.isArray(row.properties) ? row.properties : row.properties ? [row.properties] : []);
      }

      setProperties(nextProperties);
      lastRefreshAtRef.current = Date.now();

      const storedPropertyId = typeof window !== 'undefined'
        ? window.localStorage.getItem(STORAGE_KEY)
        : null;
      const nextSelectedProperty = nextProperties.find((property) => property.id === selectedPropertyId)
        ?? nextProperties.find((property) => property.id === storedPropertyId)
        ?? nextProperties[0]
        ?? null;

      persistSelection(nextSelectedProperty?.id ?? null);
    } catch (nextError) {
      console.error('Properties refresh error:', nextError);
      if (requestId !== refreshRequestRef.current) return;
      setProperties([]);
      persistSelection(null);
      setError(nextError instanceof Error ? nextError.message : 'Unable to load properties.');
    } finally {
      if (requestId === refreshRequestRef.current) {
        setIsLoading(false);
      }
    }
  }, [role, selectedPropertyId, user?.id]);

  useEffect(() => {
    void refreshPropertiesInternal();
  }, [refreshPropertiesInternal]);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        isAdminRole(role) &&
        Date.now() - lastRefreshAtRef.current > FOCUS_REFRESH_INTERVAL_MS
      ) {
        void refreshPropertiesInternal({ silent: true });
      }
    };

    const handleOnline = () => {
      if (isAdminRole(role)) {
        void refreshPropertiesInternal({ silent: true });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, [refreshPropertiesInternal, role]);

  useEffect(() => {
    if (typeof document === 'undefined') return;

    const selectedProperty = properties.find((property) => property.id === selectedPropertyId) ?? null;
    const themeColor = selectedProperty?.theme_color?.trim();

    if (!themeColor) {
      document.documentElement.style.setProperty('--primary', DEFAULT_THEME.primary);
      document.documentElement.style.setProperty('--primary-hover', DEFAULT_THEME.primaryHover);
      document.documentElement.style.setProperty('--primary-glow', DEFAULT_THEME.primaryGlow);
      document.documentElement.style.setProperty('--border-focus', DEFAULT_THEME.borderFocus);
      return;
    }

    document.documentElement.style.setProperty('--primary', themeColor);
    document.documentElement.style.setProperty('--primary-hover', shadeHex(themeColor, 0.2));
    document.documentElement.style.setProperty('--primary-glow', rgbaFromHex(themeColor, 0.3));
    document.documentElement.style.setProperty('--border-focus', rgbaFromHex(themeColor, 0.5));
  }, [properties, selectedPropertyId]);

  const createProperty = useCallback(async ({ name, location, theme_color }: { name: string; location: string; theme_color?: string }) => {
    const trimmedName = name.trim();
    const trimmedLocation = location.trim();
    const trimmedThemeColor = theme_color?.trim() || DEFAULT_THEME.primary;

    if (!trimmedName) {
      return { error: 'Please enter a property name.' };
    }

    const { data, error: createError } = await supabase
      .from('properties')
      .insert([{ name: trimmedName, location: trimmedLocation, theme_color: trimmedThemeColor }])
      .select('id, name, location, theme_color')
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
    theme_color,
  }: {
    id: string;
    name: string;
    location: string;
    theme_color?: string;
  }) => {
    const trimmedName = name.trim();
    const trimmedLocation = location.trim();
    const trimmedThemeColor = theme_color?.trim() || DEFAULT_THEME.primary;

    if (!trimmedName) {
      return { error: 'Please enter a property name.' };
    }

    const { data, error: updateError } = await supabase
      .from('properties')
      .update({
        name: trimmedName,
        location: trimmedLocation,
        theme_color: trimmedThemeColor,
      })
      .eq('id', id)
      .select('id, name, location, theme_color')
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
      refreshProperties: () => refreshPropertiesInternal(),
      selectProperty: persistSelection,
      createProperty,
      updateProperty,
      deleteProperty,
    };
  }, [properties, selectedPropertyId, isLoading, error, refreshPropertiesInternal, createProperty, updateProperty, deleteProperty]);

  return (
    <AdminPropertyContext.Provider value={value}>
      {children}
    </AdminPropertyContext.Provider>
  );
};

export const useAdminProperty = () => useContext(AdminPropertyContext);
