import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { supabase } from '../lib/supabase';
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
};

type AppSettingsContextValue = {
  settings: AppSettings;
  isLoading: boolean;
  error: string | null;
  refreshSettings: () => Promise<void>;
};

const DEFAULT_SETTINGS: AppSettings = {
  site_name: 'BedSpace',
  currency_code: 'AED',
  currency_symbol: 'AED',
  company_name: 'BedSpace',
  support_email: '',
  support_phone: '',
  timezone: 'Asia/Dubai',
  expense_categories: 'Maintenance\nUtilities\nSupplies\nRepairs\nCleaning\nOther',
};

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
});

export const AppSettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshSettings = async () => {
    setIsLoading(true);
    setError(null);

    const { data, error: settingsError } = await supabase
      .from('app_settings')
      .select('site_name, currency_code, currency_symbol, company_name, support_email, support_phone, timezone, expense_categories')
      .eq('id', 1)
      .maybeSingle();

    if (settingsError) {
      if (settingsError.code === '42P01' || settingsError.code === '42703') {
        const fallbackSettings = normalizeSettings(null);
        setSettings(fallbackSettings);
        setFormattingSettings({
          currencyCode: fallbackSettings.currency_code,
          currencySymbol: fallbackSettings.currency_symbol,
        });
        setError('Settings table is not ready yet. Using default app settings for now.');
        setIsLoading(false);
        return;
      }

      console.error('App settings fetch error:', settingsError);
      const fallbackSettings = normalizeSettings(null);
      setSettings(fallbackSettings);
      setFormattingSettings({
        currencyCode: fallbackSettings.currency_code,
        currencySymbol: fallbackSettings.currency_symbol,
      });
      setError(settingsError.message || 'Unable to load app settings.');
      setIsLoading(false);
      return;
    }

    const normalized = normalizeSettings(data);
    setSettings(normalized);
    setFormattingSettings({
      currencyCode: normalized.currency_code,
      currencySymbol: normalized.currency_symbol,
    });
    setIsLoading(false);
  };

  useEffect(() => {
    void refreshSettings();
  }, []);

  const value = useMemo(() => ({
    settings,
    isLoading,
    error,
    refreshSettings,
  }), [settings, isLoading, error]);

  return (
    <AppSettingsContext.Provider value={value}>
      {children}
    </AppSettingsContext.Provider>
  );
};

export const useAppSettings = () => useContext(AppSettingsContext);
