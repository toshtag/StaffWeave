import { describe, expect, it } from 'vitest';
import { hasPermission, isRole, permissionsOf } from './roles.js';

describe('hasPermission', () => {
  it('ワークスペース管理者はすべての権限を持つ', () => {
    expect(hasPermission(['workspace_admin'], 'organization.manage')).toBe(true);
    expect(hasPermission(['workspace_admin'], 'user.manage')).toBe(true);
  });

  it('組織管理者は閲覧と承認ができるが、組織の変更と締めはできない', () => {
    expect(hasPermission(['organization_manager'], 'organization.read')).toBe(true);
    expect(hasPermission(['organization_manager'], 'attendance.approve')).toBe(true);
    expect(hasPermission(['organization_manager'], 'organization.manage')).toBe(false);
    expect(hasPermission(['organization_manager'], 'user.manage')).toBe(false);
    expect(hasPermission(['organization_manager'], 'attendance.close')).toBe(false);
  });

  it('従業員は他人の情報を閲覧できない', () => {
    expect(hasPermission(['employee'], 'employee.read')).toBe(false);
    expect(hasPermission(['employee'], 'organization.read')).toBe(false);
  });

  it('複数のロールを持つ場合はいずれかの権限で許可される', () => {
    expect(hasPermission(['employee', 'organization_manager'], 'organization.read')).toBe(true);
  });

  it('ロールが無ければ何も許可されない', () => {
    expect(hasPermission([], 'organization.read')).toBe(false);
  });
});

describe('permissionsOf', () => {
  it('重複を排除して一覧を返す', () => {
    const permissions = permissionsOf(['organization_manager', 'organization_manager']);
    expect(permissions).toEqual(['organization.read', 'employee.read', 'attendance.approve']);
  });

  // 監査記録は従業員に紐づかない操作も含み、閲覧範囲で絞れない。
  it('監査記録を読めるのはワークスペース管理者だけ', () => {
    expect(hasPermission(['workspace_admin'], 'audit.read')).toBe(true);
    expect(hasPermission(['organization_manager'], 'audit.read')).toBe(false);
    expect(hasPermission(['employee'], 'audit.read')).toBe(false);
  });
});

describe('isRole', () => {
  it('未知の値を拒否する', () => {
    expect(isRole('workspace_admin')).toBe(true);
    expect(isRole('superuser')).toBe(false);
  });
});
