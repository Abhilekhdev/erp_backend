/**
 * The business owner's role, created automatically at registration.
 *
 * It is the `Gate::before` wildcard — holding it grants EVERY permission (see PermissionsGuard /
 * AbilityService). It sits above a normal "Admin" role, so it is:
 *   - never offered in the user-create role dropdown,
 *   - never assignable to (or removable from) anyone via the API,
 *   - not editable/deletable as a role.
 *
 * "Admin" is therefore free to be created as an ordinary, permission-scoped role.
 */
export const OWNER_ROLE = 'Super Admin';
