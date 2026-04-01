import { useEffect, useRef, useState } from 'react';
import { CloudUpload, RotateCcw, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { useAuth } from '../../contexts/AuthContext';
import { AppSettings, useAppSettings } from '../../contexts/AppSettingsContext';
import { writeActivityLog } from '../../lib/admin';
import { buildBackupFileName, fetchBackupPayload, restoreBackupPayload, type BackupPayload } from '../../lib/backup';
import { downloadGoogleDriveBackup, listGoogleDriveBackups, type GoogleDriveFile, uploadJsonBackupToGoogleDrive } from '../../lib/googleDrive';
import { supabase } from '../../lib/supabase';

type SettingsFormState = AppSettings;

export const Settings = () => {
  const { user, role } = useAuth();
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
  const [showCreatePropertyForm, setShowCreatePropertyForm] = useState(false);
  const [pendingDeletePropertyId, setPendingDeletePropertyId] = useState<string | null>(null);
  const [backupState, setBackupState] = useState<{
    isUploading: boolean;
    isRestoring: boolean;
    message: string;
    tone: 'success' | 'danger';
  }>({
    isUploading: false,
    isRestoring: false,
    message: '',
    tone: 'success',
  });
  const [pendingRestorePayload, setPendingRestorePayload] = useState<BackupPayload | null>(null);
  const [driveBackups, setDriveBackups] = useState<GoogleDriveFile[]>([]);
  const [showDriveRestoreList, setShowDriveRestoreList] = useState(false);
  const restoreInputRef = useRef<HTMLInputElement | null>(null);

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
    setShowCreatePropertyForm(false);
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

  const handleBackupData = async () => {
    if (!role) return;

    setBackupState((current) => ({
      ...current,
      isUploading: true,
      message: '',
      tone: 'success',
    }));

    try {
      const payload = await fetchBackupPayload({
        role,
        selectedPropertyId,
        selectedPropertyName: properties.find((property) => property.id === selectedPropertyId)?.name,
      });
      const filename = buildBackupFileName();
      const uploadResult = await uploadJsonBackupToGoogleDrive({
        filename,
        jsonContent: JSON.stringify(payload, null, 2),
      });

      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: `Backup uploaded successfully to Google Drive as ${uploadResult.name}.`,
        tone: 'success',
      });
    } catch (backupError) {
      console.error('Backup upload error:', backupError);
      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: backupError instanceof Error ? backupError.message : 'Backup failed. Please try again.',
        tone: 'danger',
      });
    }
  };

  const handlePickRestoreFile = () => {
    restoreInputRef.current?.click();
  };

  const handleLoadDriveBackups = async () => {
    setBackupState((current) => ({
      ...current,
      isRestoring: true,
      message: '',
      tone: 'success',
    }));

    try {
      const files = await listGoogleDriveBackups();
      setDriveBackups(files);
      setShowDriveRestoreList(true);
      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: files.length === 0 ? 'No Google Drive backups were found.' : 'Choose a Google Drive backup to restore.',
        tone: files.length === 0 ? 'danger' : 'success',
      });
    } catch (driveError) {
      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: driveError instanceof Error ? driveError.message : 'Unable to load Google Drive backups.',
        tone: 'danger',
      });
    }
  };

  const handleSelectDriveBackup = async (file: GoogleDriveFile) => {
    setBackupState({
      isUploading: false,
      isRestoring: true,
      message: '',
      tone: 'success',
    });

    try {
      const rawContent = await downloadGoogleDriveBackup(file.id);
      const parsed = JSON.parse(rawContent) as BackupPayload;

      if (!parsed?.tables || !parsed?.generated_at) {
        throw new Error('The selected Google Drive file is not a valid BedSpace backup.');
      }

      setPendingRestorePayload(parsed);
      setShowDriveRestoreList(false);
      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: `Loaded ${file.name}. Confirm restore to continue.`,
        tone: 'success',
      });
    } catch (driveError) {
      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: driveError instanceof Error ? driveError.message : 'Unable to load the selected Google Drive backup.',
        tone: 'danger',
      });
    }
  };

  const handleRestoreFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    try {
      const rawContent = await file.text();
      const parsed = JSON.parse(rawContent) as BackupPayload;

      if (!parsed?.tables || !parsed?.generated_at) {
        setBackupState({
          isUploading: false,
          isRestoring: false,
          message: 'This file does not look like a valid BedSpace backup.',
          tone: 'danger',
        });
        return;
      }

      setPendingRestorePayload(parsed);
    } catch (restoreError) {
      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: restoreError instanceof Error ? restoreError.message : 'Unable to read the backup file.',
        tone: 'danger',
      });
    }
  };

  const handleConfirmRestore = async () => {
    if (!pendingRestorePayload) return;

    setBackupState({
      isUploading: false,
      isRestoring: true,
      message: '',
      tone: 'success',
    });

    try {
      await restoreBackupPayload(pendingRestorePayload);
      await refreshSettings();

      await writeActivityLog({
        action: 'backup.restored',
        entityType: 'backup',
        entityId: pendingRestorePayload.generated_at,
        description: `Restored backup generated at ${pendingRestorePayload.generated_at}.`,
        actorId: user?.id,
      });

      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: 'Backup restored successfully. Refresh any open pages to see the latest restored data.',
        tone: 'success',
      });
    } catch (restoreError) {
      console.error('Restore error:', restoreError);
      setBackupState({
        isUploading: false,
        isRestoring: false,
        message: restoreError instanceof Error ? restoreError.message : 'Restore failed. Please try again.',
        tone: 'danger',
      });
    } finally {
      setPendingRestorePayload(null);
    }
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
          <h1 className="page-title">Application settings</h1>
        </div>
      </div>

      {error && (
        <Card style={{ marginBottom: '1.5rem', borderColor: 'rgba(245, 158, 11, 0.35)' }}>
          <h3 style={{ marginBottom: '0.5rem' }}>Using fallback settings</h3>
          <p style={{ color: 'var(--text-secondary)' }}>{error}</p>
        </Card>
      )}

      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ marginBottom: '1rem', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <h2 style={{ margin: 0 }}>Properties</h2>
          <Button
            type="button"
            variant={showCreatePropertyForm ? 'secondary' : 'primary'}
            onClick={() => {
              setShowCreatePropertyForm((current) => !current);
              setPropertyError('');
              setPropertySuccess('');
              if (showCreatePropertyForm) {
                setPropertyName('');
                setPropertyLocation('');
              }
            }}
          >
            <Plus size={16} />
            {showCreatePropertyForm ? 'Close Add Property' : 'Add Property'}
          </Button>
        </div>

        {propertiesError && (
          <div style={{ color: 'var(--warning)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: 'var(--warning-bg)', borderRadius: 'var(--radius-sm)', marginBottom: '1rem' }}>
            {propertiesError}
          </div>
        )}

        {showCreatePropertyForm ? (
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
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem', flexWrap: 'wrap' }}>
              <Button type="button" variant="secondary" onClick={() => setShowCreatePropertyForm(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={propertiesLoading}>
                Save Property
              </Button>
            </div>
          </form>
        ) : null}

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
        <div style={{ marginBottom: '1rem' }}>
          <h2 style={{ marginBottom: 0 }}>Application Settings</h2>
        </div>

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

          {backupState.message && (
            <div style={{ gridColumn: '1 / -1', color: backupState.tone === 'danger' ? 'var(--danger)' : 'var(--success)', fontSize: '0.875rem', padding: '0.75rem 1rem', background: backupState.tone === 'danger' ? 'var(--danger-bg)' : 'var(--success-bg)', borderRadius: 'var(--radius-sm)' }}>
              {backupState.message}
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

          <div style={{ gridColumn: '1 / -1', display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', padding: '1rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
            <div>
              <div style={{ fontWeight: 600, marginBottom: '0.35rem' }}>Backup & Restore</div>
              <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                Backup uploads the latest JSON snapshot to Google Drive. Restore can use a local JSON file or a backup directly from Google Drive.
              </div>
            </div>
            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
              <input
                ref={restoreInputRef}
                type="file"
                accept="application/json,.json"
                onChange={(event) => void handleRestoreFileSelected(event)}
                style={{ display: 'none' }}
              />
              <Button type="button" variant="secondary" onClick={() => void handleBackupData()} isLoading={backupState.isUploading}>
                <CloudUpload size={16} /> Backup To Drive
              </Button>
              <Button type="button" variant="secondary" onClick={handlePickRestoreFile} isLoading={backupState.isRestoring}>
                <RotateCcw size={16} /> Restore File
              </Button>
              <Button type="button" variant="secondary" onClick={() => void handleLoadDriveBackups()} isLoading={backupState.isRestoring}>
                <RotateCcw size={16} /> Restore From Drive
              </Button>
            </div>
          </div>

          {showDriveRestoreList && (
            <div style={{ gridColumn: '1 / -1', padding: '1rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', background: 'rgba(255,255,255,0.02)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', marginBottom: '0.85rem', flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 600 }}>Google Drive Backups</div>
                <Button type="button" variant="secondary" onClick={() => setShowDriveRestoreList(false)}>
                  Close
                </Button>
              </div>
              {driveBackups.length === 0 ? (
                <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>No Drive backups found.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  {driveBackups.map((file) => (
                    <div key={file.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', padding: '0.85rem 1rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', background: 'rgba(15, 23, 42, 0.35)' }}>
                      <div>
                        <div style={{ fontWeight: 600 }}>{file.name}</div>
                        <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                          {file.modifiedTime ? `Updated ${format(new Date(file.modifiedTime), 'MMM dd, yyyy h:mm a')}` : 'Google Drive backup'}
                        </div>
                      </div>
                      <Button type="button" variant="secondary" onClick={() => void handleSelectDriveBackup(file)}>
                        Restore
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

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
      <ConfirmDialog
        open={pendingRestorePayload !== null}
        title="Restore Backup"
        message="Restore this backup into the current database? This will upsert the backup data into the existing records."
        confirmLabel="Restore"
        tone="warning"
        onCancel={() => setPendingRestorePayload(null)}
        onConfirm={async () => {
          await handleConfirmRestore();
        }}
      />
    </div>
  );
};
