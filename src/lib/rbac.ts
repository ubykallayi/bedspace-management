export type AppRole = 'super_admin' | 'owner' | 'manager' | 'tenant';

export const ADMIN_ROLES: AppRole[] = ['super_admin', 'owner', 'manager'];

export const isAdminRole = (role: AppRole | null | undefined): role is Exclude<AppRole, 'tenant'> => (
  role === 'super_admin' || role === 'owner' || role === 'manager'
);

export const canAccessRooms = (role: AppRole | null | undefined) => (
  role === 'super_admin' || role === 'owner'
);

export const canAccessSettings = (role: AppRole | null | undefined) => role === 'super_admin';

export const canManageUsers = (role: AppRole | null | undefined) => role === 'super_admin';

export const getDefaultRouteForRole = (role: AppRole | null | undefined) => {
  if (role === 'tenant') return '/tenant';
  if (isAdminRole(role)) return '/admin';
  return '/login';
};

export const getRoleLabel = (role: AppRole | null | undefined) => {
  if (role === 'super_admin') return 'Super Admin';
  if (role === 'owner') return 'Owner';
  if (role === 'manager') return 'Manager';
  if (role === 'tenant') return 'Tenant';
  return 'Loading...';
};
