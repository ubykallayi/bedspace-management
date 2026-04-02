import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase, withSupabaseTimeout } from '../lib/supabase';
import { setFormattingSettings } from '../lib/admin';

export type AppSettings = {
  site_name: string;
  currency_code: string;
  currency_symbol: string;
  company_name: string;
  support_email: string;
  support_phone: string;
  timezone: string;
  expense_categories: string;
  google_drive_client_id: string;
};

type AppSettingsContextValue = {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
  refreshSettings: () => Promise<void>;
};

const FOCUS_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

const DEFAULT_SETTINGS: AppSettings = {
  site_name: 'BedSpace',
  currency_code: 'AED',
  currency_symbol: 'AED',
  company_name: 'BedSpace',
  support_email: '',
  support_phone: '',
  timezone: 'Asia/Dubai',
  expense_categories: 'Maintenance\nUtilities\nSupplies\nRepairs\nCleaning\nOther',
  google_drive_client_id: '',
};

let currentSettingsSnapshot: AppSettings = DEFAULT_SETTINGS;

export const getAppSettingsSnapshot = () => currentSettingsSnapshot;

const AppSettingsContext = createContext<AppSettingsContextValue>({
  settings: DEFAULT_SETTINGS,
  isLoading: true,
  error: null,
  refreshSettings: async () => {},
});

const normalizeSettings = (value?: Partial<AppSettings> | null): AppSettings => ({
  site_name: value?.site_name?.trim() || DEFAULT_SETTINGS.site_name,
  currency_code: value?.currency_code?.trim() || DEFAULT_SETTINGS.currency_code,
  currency_symbol: value?.currency_symbol?.trim() || DEFAULT_SETTINGS.currency_symbol,
  company_name: value?.company_name?.trim() || DEFAULT_SETTINGS.company_name,
  support_email: value?.support_email?.trim() || DEFAULT_SETTINGS.support_email,
  support_phone: value?.support_phone?.trim() || DEFAULT_SETTINGS.support_phone,
  timezone: value?.timezone?.trim() || DEFAULT_SETTINGS.timezone,
  expense_categories: value?.expense_categories?.trim() || DEFAULT_SETTINGS.expense_categories,
  google_drive_client_id: value?.google_drive_client_id?.trim() || DEFAULT_SETTINGS.google_drive_client_id,
});

export const AppSettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const refreshRequestRef = useRef(0);
  const lastRefreshAtRef = useRef(0);

  const refreshSettingsInternal = async ({ silent = false }: { silent?: boolean } = {}) => {
    const requestId = ++refreshRequestRef.current;
    if (!silent || lastRefreshAtRef.current === 0) {
      setIsLoading(true);
    }
    if (!silent) {
      setError(null);
    }

    try {
      const { data, error: settingsError } = await withSupabaseTimeout(
        supabase
          .from('app_settings')
          .select('site_name, currency_code, currency_symbol, company_name, support_email, support_phone, timezone, expense_categories, google_drive_client_id')
          .eq('id', 1)
          .maybeSingle(),
        'Settings took too long to load. Please try again.',
      );

      if (requestId !== refreshRequestRef.current) return;

      if (settingsError) {
        if (settingsError.code === '42P01' || settingsError.code === '42703') {
          const fallbackSettings = normalizeSettings(null);
          setSettings(fallbackSettings);
          currentSettingsSnapshot = fallbackSettings;
          setFormattingSettings({
            currencyCode: fallbackSettings.currency_code,
            currencySymbol: fallbackSettings.currency_symbol,
          });
          setError('Settings table is not ready yet. Using default app settings for now.');
          return;
        }

        console.error('App settings fetch error:', settingsError);
        const fallbackSettings = normalizeSettings(null);
        setSettings(fallbackSettings);
        currentSettingsSnapshot = fallbackSettings;
        setFormattingSettings({
          currencyCode: fallbackSettings.currency_code,
          currencySymbol: fallbackSettings.currency_symbol,
        });
        setError(settingsError.message || 'Unable to load app settings.');
        return;
      }

      const normalized = normalizeSettings(data);
      setSettings(normalized);
      currentSettingsSnapshot = normalized;
      lastRefreshAtRef.current = Date.now();
      setFormattingSettings({
        currencyCode: normalized.currency_code,
        currencySymbol: normalized.currency_symbol,
      });
    } catch (nextError) {
      console.error('App settings refresh error:', nextError);
      const fallbackSettings = normalizeSettings(null);
      setSettings(fallbackSettings);
      currentSettingsSnapshot = fallbackSettings;
      setFormattingSettings({
        currencyCode: fallbackSettings.currency_code,
        currencySymbol: fallbackSettings.currency_symbol,
      });
      setError(nextError instanceof Error ? nextError.message : 'Unable to load app settings.');
    } finally {
      if (requestId === refreshRequestRef.current) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    void refreshSettingsInternal();
  }, []);

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (
        document.visibilityState === 'visible' &&
        Date.now() - lastRefreshAtRef.current > FOCUS_REFRESH_INTERVAL_MS
      ) {
        void refreshSettingsInternal({ silent: true });
      }
    };

    const handleOnline = () => {
      void refreshSettingsInternal({ silent: true });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('online', handleOnline);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('online', handleOnline);
    };
  }, []);

  const value = useMemo(() => ({
    settings,
    isLoading,
    error,
    refreshSettings: () => refreshSettingsInternal(),
  }), [settings, isLoading, error]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = () => useContext(AppSettingsContext);
