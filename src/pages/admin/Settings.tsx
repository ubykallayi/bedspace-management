import { useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { useAuth } from '../../contexts/AuthContext';
import { AppSettings, useAppSettings } from '../../contexts/AppSettingsContext';
import { writeActivityLog } from '../../lib/admin';
import { supabase } from '../../lib/supabase';

type SettingsFormState = AppSettings;

export const Settings = () => {
  const { user } = useAuth();
  const { settings, isLoading, error, refreshSettings } = useAppSettings();
  const [formData, setFormData] = useState<SettingsFormState>(settings);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');

  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const updateField = (field: keyof SettingsFormState, value: string) => {
    setFormData((current) => ({
      ...current,
      [field]: value,
    }));
    setSaveError('');
    setSaveSuccess('');
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setSaveError('');
    setSaveSuccess('');

    const payload = {
      id: 1,
      site_name: formData.site_name.trim(),
      currency_code: formData.currency_code.trim().toUpperCase(),
      currency_symbol: formData.currency_symbol.trim(),
      company_name: formData.company_name.trim(),
      support_email: formData.support_email.trim(),
      support_phone: formData.support_phone.trim(),
      timezone: formData.timezone.trim(),
      expense_categories: formData.expense_categories.trim(),
      updated_at: new Date().toISOString(),
      updated_by: user?.id ?? null,
    };

    const { error: upsertError } = await supabase
      .from('app_settings')
      .upsert(payload, { onConflict: 'id' });

    if (upsertError) {
      console.error('Settings save error:', upsertError);
      setSaveError(upsertError.message || 'Unable to save settings.');
      setSaving(false);
      return;
    }

    await writeActivityLog({
      action: 'settings.updated',
      entityType: 'app_settings',
      entityId: '00000000-0000-0000-0000-000000000001',
      description: 'Updated application settings.',
      actorId: user?.id,
    });

    await refreshSettings();
    setSaveSuccess('Settings updated successfully.');
    setSaving(false);
  };

  if (isLoading) {
    return (
      <div className="page-container">
        <Card>
          <h2 style={{ marginBottom: '0.5rem' }}>Loading settings...</h2>
          <p style={{ color: 'var(--text-secondary)' }}>We are loading your application preferences now.</p>
        </Card>
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Manage branding, currency display, and contact details for this property.</p>
        </div>
      </div>

      {error && (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Using fallback settings</h3>
          <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </Card>
      )}

      <Card>
        <form onSubmit={handleSave} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
          <Input
            label="Site Name"
            value={formData.site_name}
            onChange={(e) => updateField('site_name', e.target.value)}
            required
          />
          <Input
            label="Company Name"
            value={formData.company_name}
            onChange={(e) => updateField('company_name', e.target.value)}
            required
          />
          <Input
            label="Currency Code"
            value={formData.currency_code}
            onChange={(e) => updateField('currency_code', e.target.value.toUpperCase())}
            placeholder="AED"
            required
          />
          <Input
            label="Currency Display"
            value={formData.currency_symbol}
            onChange={(e) => updateField('currency_symbol', e.target.value)}
            placeholder="AED"
            required
          />
          <Input
            label="Support Email"
            type="email"
            value={formData.support_email}
            onChange={(e) => updateField('support_email', e.target.value)}
            placeholder="support@example.com"
          />
          <Input
            label="Support Phone"
            value={formData.support_phone}
            onChange={(e) => updateField('support_phone', e.target.value)}
            placeholder="+971..."
          />
          <Input
            label="Timezone"
            value={formData.timezone}
            onChange={(e) => updateField('timezone', e.target.value)}
            placeholder="Asia/Dubai"
            required
          />
          <div className="form-group" style={{ gridColumn: '1 / -1' }}>
            <label className="form-label">Expense Categories</label>
            <textarea
              className="form-input"
              rows={6}
              value={formData.expense_categories}
              onChange={(e) => updateField('expense_categories', e.target.value)}
              placeholder={'Maintenance\nUtilities\nSupplies'}
              style={{ resize: 'vertical', minHeight: '140px' }}
            />
          </div>

          {saveError && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--danger)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)' }}>
              {saveError}
            </div>
          )}

          {saveSuccess && (
            <div style={{ gridColumn: '1 / -1', color: 'var(--success)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--success-bg)', borderRadius: 'var(--radius-sm)' }}>
              {saveSuccess}
            </div>
          )}

          <p style={{ gridColumn: '1 / -1', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
            Currency Display controls how amounts appear in the UI. For example, using `AED` will show values like `AED 1200.00`.
          </p>
          <p style={{ gridColumn: '1 / -1', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
            Expense Categories should be entered one per line. These values will appear in the expense form dropdown.
          </p>

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" isLoading={saving}>
              <Save size={16} /> Save Settings
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};
