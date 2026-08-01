/**
 * ロールと権限。
 *
 * ロールは「誰が何をできるか」を決める唯一の根拠とし、
 * 個別の画面や API が独自の条件分岐で権限を判断しないようにする。
 */

export const ROLES = ['workspace_admin', 'organization_manager', 'employee'] as const;

export type Role = (typeof ROLES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

export const PERMISSIONS = [
  /** 組織・拠点・部門の作成と変更 */
  'organization.manage',
  /** 組織構造の閲覧 */
  'organization.read',
  /** 従業員の登録と変更 */
  'employee.manage',
  /** 自分以外の従業員の閲覧 */
  'employee.read',
  /** 利用者アカウントの作成と変更 */
  'user.manage',
  /** 日次申請の承認・差し戻し */
  'attendance.approve',
  /** 月次締めと締め解除 */
  'attendance.close',
  /** 監査記録の閲覧 */
  'audit.read',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<Role, readonly Permission[]> = {
  workspace_admin: [
    'organization.manage',
    'organization.read',
    'employee.manage',
    'employee.read',
    'user.manage',
    'attendance.approve',
    'attendance.close',
    'audit.read',
  ],
  organization_manager: ['organization.read', 'employee.read', 'attendance.approve'],
  employee: [],
};

/** いずれかのロールが権限を持つかどうか。 */
export function hasPermission(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => ROLE_PERMISSIONS[role].includes(permission));
}

/** ロール集合が持つ権限の一覧。UI の表示制御に使う。 */
export function permissionsOf(roles: readonly Role[]): Permission[] {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role]) {
      granted.add(permission);
    }
  }
  return PERMISSIONS.filter((permission) => granted.has(permission));
}
