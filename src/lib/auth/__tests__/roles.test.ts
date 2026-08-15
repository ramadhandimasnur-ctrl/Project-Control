import { describe, expect, it } from 'vitest';

import {
  canApproveProgress,
  canDeleteProject,
  canEditContractTerms,
  canEditProjectData,
  canManageMembers,
  canRecordFieldData,
  canViewCosts,
  hasAtLeast,
  isProjectRole,
  PROJECT_ROLES,
  type ProjectRole,
} from '../roles';

describe('hasAtLeast', () => {
  it('orders roles by breadth of authority', () => {
    expect(hasAtLeast('ADMIN', 'PROJECT_MANAGER')).toBe(true);
    expect(hasAtLeast('PROJECT_MANAGER', 'ENGINEER')).toBe(true);
    expect(hasAtLeast('ENGINEER', 'FIELD_USER')).toBe(true);
    expect(hasAtLeast('FIELD_USER', 'VIEWER')).toBe(true);
  });

  it('is reflexive', () => {
    for (const role of PROJECT_ROLES) {
      expect(hasAtLeast(role, role)).toBe(true);
    }
  });

  it('refuses to promote a lower role', () => {
    expect(hasAtLeast('ENGINEER', 'PROJECT_MANAGER')).toBe(false);
    expect(hasAtLeast('VIEWER', 'FIELD_USER')).toBe(false);
    expect(hasAtLeast('FIELD_USER', 'ENGINEER')).toBe(false);
  });
});

describe('capabilities defined by the charter role table', () => {
  const table: ReadonlyArray<{
    role: ProjectRole;
    edit: boolean;
    field: boolean;
    approve: boolean;
    contract: boolean;
    remove: boolean;
    members: boolean;
    costs: boolean;
  }> = [
    { role: 'ADMIN', edit: true, field: true, approve: true, contract: true, remove: true, members: true, costs: true },
    { role: 'PROJECT_MANAGER', edit: true, field: true, approve: true, contract: true, remove: true, members: true, costs: true },
    { role: 'ENGINEER', edit: true, field: true, approve: false, contract: false, remove: false, members: false, costs: true },
    { role: 'FIELD_USER', edit: false, field: true, approve: false, contract: false, remove: false, members: false, costs: false },
    { role: 'VIEWER', edit: false, field: false, approve: false, contract: false, remove: false, members: false, costs: true },
  ];

  it.each(table)('$role', (row) => {
    expect(canEditProjectData(row.role)).toBe(row.edit);
    expect(canRecordFieldData(row.role)).toBe(row.field);
    expect(canApproveProgress(row.role)).toBe(row.approve);
    expect(canEditContractTerms(row.role)).toBe(row.contract);
    expect(canDeleteProject(row.role)).toBe(row.remove);
    expect(canManageMembers(row.role)).toBe(row.members);
    expect(canViewCosts(row.role)).toBe(row.costs);
  });

  // The single most consequential rule: an engineer must not sign off on
  // their own progress submission.
  it('never lets an ENGINEER approve progress', () => {
    expect(canApproveProgress('ENGINEER')).toBe(false);
  });

  // FIELD_USER is the only role that must never receive commercial figures.
  it('hides costs from FIELD_USER only', () => {
    const hidden = PROJECT_ROLES.filter((r) => !canViewCosts(r));
    expect(hidden).toEqual(['FIELD_USER']);
  });
});

describe('isProjectRole', () => {
  it('accepts known roles and rejects anything else', () => {
    expect(isProjectRole('ENGINEER')).toBe(true);
    expect(isProjectRole('engineer')).toBe(false);
    expect(isProjectRole('SUPERUSER')).toBe(false);
  });
});
