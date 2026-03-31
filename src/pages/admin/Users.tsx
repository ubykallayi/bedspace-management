import { useCallback, useEffect, useMemo, useState } from 'react';
import { Info, Pencil, Save, ShieldCheck, Trash2, UserPlus } from 'lucide-react';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { ConfirmDialog } from '../../components/ui/ConfirmDialog';
import { Input } from '../../components/ui/Input';
import { useAdminProperty } from '../../contexts/AdminPropertyContext';
import { useAuth } from '../../contexts/AuthContext';
import { writeActivityLog } from '../../lib/admin';
import { AppRole, getRoleLabel } from '../../lib/rbac';
import { createTransientSupabaseClient, supabase } from '../../lib/supabase';
import { syncAssignmentsForRole } from '../../lib/userAccess';

type ManagedUser = {
  id: string;
  email: string;
  role: AppRole;
  isActive: boolean;
  effectiveIsActive: boolean;
  statusReason: string;
  propertyIds: string[];
};

export const Users = () => {
  const { user } = useAuth();
  const { properties } = useAdminProperty();
  const [managedUsers, setManagedUsers] = useState<ManagedUser[]>([]);
  const [usersLoading, setUsersLoading] = useState(true);
  const [userError, setUserError] = useState('');
  const [userSuccess, setUserSuccess] = useState('');
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingUserRole, setEditingUserRole] = useState<AppRole>('tenant');
  const [editingUserPropertyIds, setEditingUserPropertyIds] = useState<string[]>([]);
  const [newUserEmail, setNewUserEmail] = useState('');
  const [newUserPassword, setNewUserPassword] = useState('');
  const [newUserRole, setNewUserRole] = useState<AppRole>('tenant');
  const [newUserPropertyIds, setNewUserPropertyIds] = useState<string[]>([]);
  const [pendingStatusUser, setPendingStatusUser] = useState<ManagedUser | null>(null);
  const [pendingDeleteUser, setPendingDeleteUser] = useState<ManagedUser | null>(null);

  const propertyNameMap = useMemo(() => (
    new Map(properties.map((property) => [property.id, property.name]))
  ), [properties]);

  const renderInfoHint = (text: string) => (
    <span
      title={text}
      aria-label={text}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: '1.2rem',
        height: '1.2rem',
        borderRadius: '999px',
        background: 'rgba(148, 163, 184, 0.12)',
        color: 'var(--text-secondary)',
        cursor: 'help',
        flexShrink: 0,
      }}
    >
      <Info size={12} />
    </span>
  );

  const fetchManagedUsers = useCallback(async () => {
    setUsersLoading(true);
    setUserError('');

    const [usersResponse, assignmentsResponse, tenantsResponse] = await Promise.all([
      supabase.from('users').select('id, email, role, is_active').order('email'),
      supabase.from('user_properties').select('user_id, property_id'),
      supabase.from('tenants').select('id, user_id, email, is_active, end_date'),
    ]);
    let { data: usersData, error: usersFetchError } = usersResponse;
    const { data: assignmentsData, error: assignmentsError } = assignmentsResponse;
    const { data: tenantsData, error: tenantsError } = tenantsResponse;

    if (usersFetchError?.code === '42703') {
      const fallbackResponse = await supabase.from('users').select('id, email, role').order('email');
      usersData = fallbackResponse.data?.map((row) => ({ ...row, is_active: true })) ?? null;
      usersFetchError = fallbackResponse.error;
    }

    if (usersFetchError) {
      console.error('Users fetch error:', usersFetchError);
      setUserError(usersFetchError.message || 'Unable to load users.');
      setUsersLoading(false);
      return;
    }

    if (assignmentsError && assignmentsError.code !== '42P01') {
      console.error('User properties fetch error:', assignmentsError);
      setUserError(assignmentsError.message || 'Unable to load property assignments.');
      setUsersLoading(false);
      return;
    }

    if (tenantsError && tenantsError.code !== '42P01' && tenantsError.code !== '42703') {
      console.error('Tenants fetch error:', tenantsError);
      setUserError(tenantsError.message || 'Unable to load tenant status data.');
      setUsersLoading(false);
      return;
    }

    const assignmentMap = new Map<string, string[]>();
    ((assignmentsData ?? []) as Array<{ user_id: string; property_id: string }>).forEach((assignment) => {
      assignmentMap.set(assignment.user_id, [...(assignmentMap.get(assignment.user_id) ?? []), assignment.property_id]);
    });

    const tenantRows = (tenantsData ?? []) as Array<{
      id: string;
      user_id?: string | null;
      email?: string | null;
      is_active?: boolean | null;
      end_date?: string | null;
    }>;
    const tenantsByUserId = new Map<string, typeof tenantRows>();
    const tenantsByEmail = new Map<string, typeof tenantRows>();

    tenantRows.forEach((tenant) => {
      if (tenant.user_id) {
        tenantsByUserId.set(tenant.user_id, [...(tenantsByUserId.get(tenant.user_id) ?? []), tenant]);
      }
      if (tenant.email) {
        const normalizedEmail = tenant.email.toLowerCase();
        tenantsByEmail.set(normalizedEmail, [...(tenantsByEmail.get(normalizedEmail) ?? []), tenant]);
      }
    });

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextUsers = ((usersData ?? []) as Array<{ id: string; email: string; role: AppRole; is_active?: boolean | null }>).map((managedUser) => {
      const relatedTenants = managedUser.role === 'tenant'
        ? [
          ...(tenantsByUserId.get(managedUser.id) ?? []),
          ...(tenantsByEmail.get(managedUser.email.toLowerCase()) ?? []),
        ].filter((tenant, index, rows) => rows.findIndex((item) => item.id === tenant.id) === index)
        : [];

      const hasActiveTenantBooking = relatedTenants.length === 0
        ? true
        : relatedTenants.some((tenant) => {
          const bookingActive = tenant.is_active !== false;
          const bookingNotExpired = !tenant.end_date || new Date(tenant.end_date) >= today;
          return bookingActive && bookingNotExpired;
        });

      const manualIsActive = managedUser.is_active !== false;
      const effectiveIsActive = manualIsActive && hasActiveTenantBooking;
      const statusReason = !manualIsActive
        ? 'Inactive by admin'
        : managedUser.role === 'tenant' && !hasActiveTenantBooking
          ? 'Inactive tenant or expired booking'
          : 'Active';

      return {
        id: managedUser.id,
        email: managedUser.email,
        role: managedUser.role,
        isActive: manualIsActive,
        effectiveIsActive,
        statusReason,
        propertyIds: assignmentMap.get(managedUser.id) ?? [],
      };
    });

    setManagedUsers(nextUsers);
    setUsersLoading(false);
  }, []);

  useEffect(() => {
    void fetchManagedUsers();
  }, [fetchManagedUsers]);

  const togglePropertySelection = (propertyId: string, selectedIds: string[], setter: (value: string[]) => void) => {
    if (selectedIds.includes(propertyId)) {
      setter(selectedIds.filter((id) => id !== propertyId));
      return;
    }

    setter([...selectedIds, propertyId]);
  };

  const resetCreateForm = () => {
    setNewUserEmail('');
    setNewUserPassword('');
    setNewUserRole('tenant');
    setNewUserPropertyIds([]);
  };

  const handleCreateUser = async (event: React.FormEvent) => {
    event.preventDefault();
    setUserError('');
    setUserSuccess('');

    const normalizedEmail = newUserEmail.trim().toLowerCase();

    if (!normalizedEmail || !newUserPassword.trim()) {
      setUserError('Please enter email and password for the new user.');
      return;
    }

    if ((newUserRole === 'owner' || newUserRole === 'manager') && newUserPropertyIds.length === 0) {
      setUserError('Assign at least one property to owners and managers.');
      return;
    }

    const transientClient = createTransientSupabaseClient();
    const { data, error: signUpError } = await transientClient.auth.signUp({
      email: normalizedEmail,
      password: newUserPassword,
    });

    if (signUpError || !data.user) {
      setUserError(signUpError?.message || 'Unable to create the user account.');
      return;
    }

    const createdUser = data.user;
    const { error: profileError } = await supabase
      .from('users')
      .upsert({
        id: createdUser.id,
        email: normalizedEmail,
        role: newUserRole,
      }, { onConflict: 'id' });

    if (profileError) {
      setUserError(profileError.message || 'Unable to save the user role.');
      return;
    }

    try {
      await syncAssignmentsForRole({
        userId: createdUser.id,
        email: normalizedEmail,
        role: newUserRole,
        selectedPropertyIds: newUserPropertyIds,
      });
    } catch (assignmentError) {
      const nextError = assignmentError instanceof Error
        ? assignmentError.message
        : 'Unable to assign properties to the user.';
      setUserError(nextError);
      return;
    }

    await writeActivityLog({
      action: 'user.created',
      entityType: 'user',
      entityId: createdUser.id,
      description: `Created ${newUserRole} user ${normalizedEmail}.`,
      actorId: user?.id,
    });

    resetCreateForm();
    setUserSuccess('User created successfully.');
    await fetchManagedUsers();
  };

  const handleStartEditUser = (managedUser: ManagedUser) => {
    setEditingUserId(managedUser.id);
    setEditingUserRole(managedUser.role);
    setEditingUserPropertyIds(managedUser.propertyIds);
    setUserError('');
    setUserSuccess('');
  };

  const handleToggleUserActive = async (managedUser: ManagedUser) => {
    setUserError('');
    setUserSuccess('');

    const { error: updateUserError } = await supabase
      .from('users')
      .update({ is_active: !managedUser.isActive })
      .eq('id', managedUser.id);

    if (updateUserError) {
      setUserError(updateUserError.message || 'Unable to update the user status.');
      return;
    }

    await writeActivityLog({
      action: managedUser.isActive ? 'user.deactivated' : 'user.activated',
      entityType: 'user',
      entityId: managedUser.id,
      description: `${managedUser.isActive ? 'Deactivated' : 'Activated'} ${managedUser.email}.`,
      actorId: user?.id,
    });

    setUserSuccess(`User ${managedUser.isActive ? 'deactivated' : 'activated'} successfully.`);
    await fetchManagedUsers();
  };

  const handleDeleteUser = async (managedUser: ManagedUser) => {
    setUserError('');
    setUserSuccess('');

    const { error } = await supabase.rpc('admin_delete_user', {
      target_user_id: managedUser.id,
    });

    if (error) {
      setUserError(
        error.code === '42883'
          ? 'Delete function is not installed yet. Run the SQL setup for user deletion first.'
          : error.message || 'Unable to delete the user.',
      );
      return;
    }

    await writeActivityLog({
      action: 'user.deleted',
      entityType: 'user',
      entityId: managedUser.id,
      description: `Deleted ${managedUser.email}.`,
      actorId: user?.id,
    });

    setUserSuccess('User deleted successfully.');
    await fetchManagedUsers();
  };

  const handleCancelEditUser = () => {
    setEditingUserId(null);
    setEditingUserRole('tenant');
    setEditingUserPropertyIds([]);
  };

  const handleSaveUserAccess = async (managedUser: ManagedUser) => {
    setUserError('');
    setUserSuccess('');

    if ((editingUserRole === 'owner' || editingUserRole === 'manager') && editingUserPropertyIds.length === 0) {
      setUserError('Owners and managers must have at least one assigned property.');
      return;
    }

    const { error: updateUserError } = await supabase
      .from('users')
      .update({ role: editingUserRole })
      .eq('id', managedUser.id);

    if (updateUserError) {
      setUserError(updateUserError.message || 'Unable to update the user role.');
      return;
    }

    try {
      await syncAssignmentsForRole({
        userId: managedUser.id,
        email: managedUser.email,
        role: editingUserRole,
        selectedPropertyIds: editingUserPropertyIds,
      });
    } catch (assignmentError) {
      const nextError = assignmentError instanceof Error
        ? assignmentError.message
        : 'Unable to save property assignments.';
      setUserError(nextError);
      return;
    }

    await writeActivityLog({
      action: 'user.access_updated',
      entityType: 'user',
      entityId: managedUser.id,
      description: `Updated access for ${managedUser.email} to ${editingUserRole}.`,
      actorId: user?.id,
    });

    handleCancelEditUser();
    setUserSuccess('User access updated successfully.');
    await fetchManagedUsers();
  };

  const renderPropertySelector = (
    selectedIds: string[],
    setter: (value: string[]) => void,
    helperText: string,
  ) => (
    <div style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', marginBottom: '0.85rem' }}>
        <div style={{ fontWeight: 600 }}>Assigned Properties</div>
        {renderInfoHint(helperText)}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0.75rem' }}>
        {properties.map((property) => (
          <label key={property.id} style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', color: 'var(--text-primary)', padding: '0.65rem 0.75rem', border: '1px solid var(--border-light)', borderRadius: 'var(--radius-sm)', background: 'rgba(255,255,255,0.02)' }}>
            <input
              type="checkbox"
              checked={selectedIds.includes(property.id)}
              onChange={() => togglePropertySelection(property.id, selectedIds, setter)}
            />
            <span>{property.name}</span>
          </label>
        ))}
      </div>
    </div>
  );

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <div>
          <h1 className="page-title">Users</h1>
          <p style={{ color: 'var(--text-secondary)' }}>Access, roles, and property allocation.</p>
        </div>
      </div>

      <Card style={{ marginBottom: '1.5rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1rem' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--primary-glow)', flexShrink: 0 }}>
            <UserPlus size={20} color="var(--primary)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Add User</h2>
            {renderInfoHint('Create user access here. Owners and managers need manual property assignment. Tenant bookings also auto-sync matching properties.')}
          </div>
        </div>

        <form onSubmit={handleCreateUser} style={{ display: 'grid', gap: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', alignItems: 'end' }}>
            <Input
              label="User Email"
              type="email"
              value={newUserEmail}
              onChange={(event) => setNewUserEmail(event.target.value)}
              placeholder="staff@example.com"
              required
            />
            <Input
              label="Temporary Password"
              type="password"
              value={newUserPassword}
              onChange={(event) => setNewUserPassword(event.target.value)}
              placeholder="Create a strong password"
              required
            />
            <div className="form-group">
              <label className="form-label">Role</label>
              <select className="form-select" value={newUserRole} onChange={(event) => setNewUserRole(event.target.value as AppRole)}>
                <option value="super_admin">Super Admin</option>
                <option value="owner">Owner</option>
                <option value="manager">Manager</option>
                <option value="tenant">Tenant</option>
              </select>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
              <Button type="submit">
                <UserPlus size={16} /> Create User
              </Button>
            </div>
          </div>

          {newUserRole !== 'super_admin' && renderPropertySelector(
            newUserPropertyIds,
            setNewUserPropertyIds,
            newUserRole === 'tenant'
              ? 'Choose one or more properties manually if needed. Matching tenant bookings will also add properties automatically.'
              : 'Choose one or more properties this user should be able to manage.',
          )}
        </form>
      </Card>

      {(userError || userSuccess) && (
        <Card style={{ marginBottom: '1.5rem', borderColor: userError ? 'rgba(239, 68, 68, 0.3)' : 'rgba(16, 185, 129, 0.3)' }}>
          <p style={{ color: userError ? 'var(--danger)' : 'var(--success)', margin: 0 }}>
            {userError || userSuccess}
          </p>
        </Card>
      )}

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', marginBottom: '1rem' }}>
          <div style={{ width: '44px', height: '44px', borderRadius: '999px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(16, 185, 129, 0.12)', flexShrink: 0 }}>
            <ShieldCheck size={20} color="var(--success)" />
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>All Users</h2>
            {renderInfoHint('Edit roles and assign one or more properties. Tenant users can also receive manual property access if needed.')}
          </div>
        </div>

        {usersLoading ? (
          <p style={{ color: 'var(--text-secondary)' }}>Loading users...</p>
        ) : managedUsers.length === 0 ? (
          <p style={{ color: 'var(--text-secondary)' }}>No users have been created yet.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {managedUsers.map((managedUser) => {
              const assignedPropertyNames = managedUser.propertyIds
                .map((propertyId) => propertyNameMap.get(propertyId) ?? propertyId)
                .join(', ');

              return (
                <div key={managedUser.id} style={{ border: '1px solid var(--border-light)', borderRadius: 'var(--radius-md)', padding: '1rem', background: 'rgba(255,255,255,0.02)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.85rem' }}>
                    <div>
                      <div style={{ fontWeight: 600 }}>{managedUser.email}</div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>{getRoleLabel(managedUser.role)}</div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
                      <span className={managedUser.effectiveIsActive ? 'badge badge-success' : 'badge badge-warning'}>
                        {managedUser.effectiveIsActive ? 'Active' : 'Inactive'}
                      </span>
                      {editingUserId !== managedUser.id && (
                        <>
                          <Button type="button" variant="secondary" onClick={() => handleStartEditUser(managedUser)}>
                            <Pencil size={16} /> Edit
                          </Button>
                          {managedUser.id !== user?.id && (
                            <>
                              <Button type="button" variant="secondary" onClick={() => setPendingStatusUser(managedUser)}>
                                {managedUser.isActive ? 'Deactivate' : 'Activate'}
                              </Button>
                              <Button type="button" variant="danger" onClick={() => setPendingDeleteUser(managedUser)}>
                                <Trash2 size={16} /> Delete
                              </Button>
                            </>
                          )}
                        </>
                      )}
                    </div>
                  </div>

                  {editingUserId === managedUser.id ? (
                    <div style={{ display: 'grid', gap: '1rem' }}>
                      <div className="form-group">
                        <label className="form-label">Role</label>
                        <select className="form-select" value={editingUserRole} onChange={(event) => setEditingUserRole(event.target.value as AppRole)}>
                          <option value="super_admin">Super Admin</option>
                          <option value="owner">Owner</option>
                          <option value="manager">Manager</option>
                          <option value="tenant">Tenant</option>
                        </select>
                      </div>

                      {editingUserRole !== 'super_admin' && renderPropertySelector(
                        editingUserPropertyIds,
                        setEditingUserPropertyIds,
                        editingUserRole === 'tenant'
                          ? 'Choose one or more properties manually if needed. Matching tenant bookings will also add properties automatically after save.'
                          : 'Choose one or more properties this user should be able to access.',
                      )}

                      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <Button type="button" variant="secondary" onClick={handleCancelEditUser}>
                          Cancel
                        </Button>
                        <Button type="button" onClick={() => void handleSaveUserAccess(managedUser)}>
                          <Save size={16} /> Save User
                        </Button>
                      </div>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Status
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        {managedUser.statusReason}
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                        Properties
                      </div>
                      <div style={{ color: 'var(--text-secondary)', fontSize: '0.875rem' }}>
                        {assignedPropertyNames || 'None'}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={pendingStatusUser !== null}
        title={pendingStatusUser?.isActive ? 'Deactivate User' : 'Activate User'}
        message={pendingStatusUser?.isActive
          ? 'Deactivate this user? They will no longer be able to log in.'
          : 'Activate this user? They will be able to log in again if their booking status also allows access.'}
        confirmLabel={pendingStatusUser?.isActive ? 'Deactivate' : 'Activate'}
        tone="warning"
        onCancel={() => setPendingStatusUser(null)}
        onConfirm={async () => {
          if (!pendingStatusUser) return;
          await handleToggleUserActive(pendingStatusUser);
          setPendingStatusUser(null);
        }}
      />
      <ConfirmDialog
        open={pendingDeleteUser !== null}
        title="Delete User"
        message="Delete this user completely? This action should remove the login account and access mappings."
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingDeleteUser(null)}
        onConfirm={async () => {
          if (!pendingDeleteUser) return;
          await handleDeleteUser(pendingDeleteUser);
          setPendingDeleteUser(null);
        }}
      />
    </div>
  );
};
