import { useEffect, useState } from 'react';
import { Pencil, Save, Trash2 } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { useAuth } from '../../contexts/AuthContext';
import { AppSettings, useAppSettings } from '../../contexts/AppSettingsContext';
import { writeActivityLog } from '../../lib/admin';
import { supabase } from '../../lib/supabase';

type SettingsFormState = AppSettings;

export const Settings = () => {
  const { user } = useAuth();
  const { settings, isLoading, error, refreshSettings } = useAppSettings();
  const {
    properties,
    selectedPropertyId,
    createProperty,
    updateProperty,
    deleteProperty,
    isLoading: propertiesLoading,
    error: propertiesError,
  } = useAdminProperty();
  const [formData, setFormData] = useState<SettingsFormState>(settings);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState('');
  const [propertyName, setPropertyName] = useState('');
  const [propertyLocation, setPropertyLocation] = useState('');
  const [propertyError, setPropertyError] = useState('');
  const [propertySuccess, setPropertySuccess] = useState('');
  const [editingPropertyId, setEditingPropertyId] = useState<string | null>(null);
  const [editingPropertyName, setEditingPropertyName] = useState('');
  const [editingPropertyLocation, setEditingPropertyLocation] = useState('');
  const [pendingDeletePropertyId, setPendingDeletePropertyId] = useState<string | null>(null);

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
      google_drive_client_id: formData.google_drive_client_id.trim(),
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

  const handleCreateProperty = async (event: React.FormEvent) => {
    event.preventDefault();
    setPropertyError('');
    setPropertySuccess('');

    const result = await createProperty({
      name: propertyName,
      location: propertyLocation,
    });

    if (result.error) {
      setPropertyError(result.error);
      return;
    }

    await writeActivityLog({
      action: 'property.created',
      entityType: 'property',
      entityId: result.property?.id ?? '',
      description: `Created property ${propertyName.trim()}.`,
      actorId: user?.id,
    });
    setPropertyName('');
    setPropertyLocation('');
    setPropertySuccess('Property created successfully.');
  };

  const handleStartEditProperty = (property: { id: string; name: string; location: string }) => {
    setEditingPropertyId(property.id);
    setEditingPropertyName(property.name);
    setEditingPropertyLocation(property.location);
    setPropertyError('');
    setPropertySuccess('');
  };

  const handleCancelEditProperty = () => {
    setEditingPropertyId(null);
    setEditingPropertyName('');
    setEditingPropertyLocation('');
  };

  const handleUpdateProperty = async (propertyId: string) => {
    setPropertyError('');
    setPropertySuccess('');

    const result = await updateProperty({
      id: propertyId,
      name: editingPropertyName,
      location: editingPropertyLocation,
    });

    if (result.error) {
      setPropertyError(result.error);
      return;
    }

    await writeActivityLog({
      action: 'property.updated',
      entityType: 'property',
      entityId: propertyId,
      description: `Updated property ${editingPropertyName.trim()}.`,
      actorId: user?.id,
    });

    handleCancelEditProperty();
    setPropertySuccess('Property updated successfully.');
  };

  const handleDeleteProperty = async (propertyId: string) => {
    setPropertyError('');
    setPropertySuccess('');

    const property = properties.find((item) => item.id === propertyId);
    const result = await deleteProperty(propertyId);

    if (result.error) {
      setPropertyError(result.error);
      return;
    }

    await writeActivityLog({
      action: 'property.deleted',
      entityType: 'property',
      entityId: propertyId,
      description: `Deleted property ${property?.name ?? 'property'}.`,
      actorId: user?.id,
    });

    if (editingPropertyId === propertyId) {
      handleCancelEditProperty();
    }

    setPropertySuccess('Property deleted successfully.');
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

      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginBottom: '0.35rem' }}>Properties</h2>
          <p style={{ color: 'var(--text-secondary)' }}>
            Create and switch between multiple properties for rooms, beds, tenants, and payment tracking.
          </p>
        </div>

        {propertiesError && (
          <div style={{ color: 'var(--warning)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--warning-bg)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
            {propertiesError}
          </div>
        )}

        <form onSubmit={handleCreateProperty} style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'end', marginBottom: '1.5rem' }}>
          <Input
            label="Property Name"
            value={propertyName}
            onChange={(event) => setPropertyName(event.target.value)}
            placeholder="e.g. Al Nahda Building"
            required
          />
          <Input
            label="Location"
            value={propertyLocation}
            onChange={(event) => setPropertyLocation(event.target.value)}
            placeholder="e.g. Dubai, Al Nahda"
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" disabled={propertiesLoading}>
              Add Property
            </Button>
          </div>
        </form>

        {propertyError && (
          <div style={{ color: 'var(--danger)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--danger-bg)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
            {propertyError}
          </div>
        )}

        {propertySuccess && (
          <div style={{ color: 'var(--success)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--success-bg)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
            {propertySuccess}
          </div>
        )}

        {properties.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No properties created yet.</p>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '1rem' }}>
            {properties.map((property) => (
              <div
                key={property.id}
                style={{
                  border: `1px solid ${property.id === selectedPropertyId ? 'var(--primary)' : 'var(--border-light)'}`,
                  borderRadius: 'var(--radius-md)',
                  padding: '1rem',
                  background: property.id === selectedPropertyId ? 'var(--primary-glow)' : 'rgba(255,255,255,0.02)',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '0.75rem', alignItems: 'center', marginBottom: '0.5rem' }}>
                  <h3 style={{ margin: 0, fontSize: '1rem' }}>{property.name}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    {property.id === selectedPropertyId && <span className="badge badge-success">Active</span>}
                    <button
                      type="button"
                      onClick={() => handleStartEditProperty(property)}
                      style={{ color: 'var(--secondary)', padding: '0.25rem' }}
                      title="Edit property"
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setPendingDeletePropertyId(property.id)}
                      style={{ color: 'var(--danger)', padding: '0.25rem' }}
                      title="Delete property"
                    >
                      <Trash2 size={16} />
                    </button>
                  </div>
                </div>
                {editingPropertyId === property.id ? (
                  <div style={{ display: 'grid', gap: '0.75rem' }}>
                    <Input
                      label="Property Name"
                      value={editingPropertyName}
                      onChange={(event) => setEditingPropertyName(event.target.value)}
                    />
                    <Input
                      label="Location"
                      value={editingPropertyLocation}
                      onChange={(event) => setEditingPropertyLocation(event.target.value)}
                    />
                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                      <Button type="button" variant="secondary" onClick={handleCancelEditProperty}>
                        Cancel
                      </Button>
                      <Button type="button" onClick={() => void handleUpdateProperty(property.id)}>
                        Save Property
                      </Button>
                    </div>
                  </div>
                ) : (
                  <p style={{ color: 'var(--text-secondary)', margin: 0 }}>
                    {property.location || 'Location not set'}
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>

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
          <Input
            label="Google Drive Client ID"
            value={formData.google_drive_client_id}
            onChange={(e) => updateField('google_drive_client_id', e.target.value)}
            placeholder="Google OAuth client ID"
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
          <p style={{ gridColumn: '1 / -1', color: 'var(--text-tertiary)', fontSize: '0.875rem' }}>
            Google Drive Client ID powers the backup button on the dashboard. Create a Google OAuth Web client, enable Google Drive API, and add your site URL to the authorized JavaScript origins.
          </p>

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'flex-end' }}>
            <Button type="submit" isLoading={saving}>
              <Save size={16} /> Save Settings
            </Button>
          </div>
        </form>
      </Card>
      <ConfirmDialog
        open={pendingDeletePropertyId !== null}
        title="Delete Property"
        message="Delete this property? This will fail if rooms, beds, or tenants are still linked to it."
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingDeletePropertyId(null)}
        onConfirm={async () => {
          if (!pendingDeletePropertyId) return;
          await handleDeleteProperty(pendingDeletePropertyId);
          setPendingDeletePropertyId(null);
        }}
      />
    </div>
  );
};
