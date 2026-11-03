import {matchPermission, hasPermission} from '../../src/utils/permission';

describe('utils: matchPermission 通配匹配', () => {
  it('精确匹配', () => {
    expect(matchPermission('system:user:delete', 'system:user:delete')).toBe(
      true
    );
    expect(matchPermission('system:user:delete', 'system:user:view')).toBe(
      false
    );
  });

  it('* 全量通配（超管）', () => {
    expect(matchPermission('*', 'system:user:delete')).toBe(true);
    expect(matchPermission('*', 'anything')).toBe(true);
  });

  it('段通配 system:user:* 覆盖 system:user 下所有操作', () => {
    expect(matchPermission('system:user:*', 'system:user:delete')).toBe(true);
    expect(matchPermission('system:user:*', 'system:user:view')).toBe(true);
    // 覆盖自身（system:user 也视为满足）
    expect(matchPermission('system:user:*', 'system:user')).toBe(true);
    // 不越界
    expect(matchPermission('system:user:*', 'system:role:delete')).toBe(false);
    expect(matchPermission('system:user:*', 'system:userinfo')).toBe(false);
  });

  it('多级段通配', () => {
    expect(matchPermission('system:*', 'system:user:delete')).toBe(true);
    expect(matchPermission('system:*', 'system')).toBe(true);
    expect(matchPermission('system:*', 'app:user:delete')).toBe(false);
  });

  it('组件码也带通配时可被更宽的用户码覆盖', () => {
    expect(matchPermission('system:*', 'system:user:*')).toBe(true);
    expect(matchPermission('*', 'system:user:*')).toBe(true);
    expect(matchPermission('system:user:*', 'system:user:*')).toBe(true);
  });
});

describe('utils: hasPermission 判定', () => {
  it('未配置 permission 一律通过', () => {
    expect(hasPermission(undefined, [])).toBe(true);
    expect(hasPermission(undefined, undefined)).toBe(true);
  });

  it('permissionCodes 未配置（宿主未接入权限）不拦截', () => {
    expect(hasPermission('system:user:delete', undefined)).toBe(true);
  });

  it('permissionCodes 为空数组时不通过', () => {
    expect(hasPermission('system:user:delete', [])).toBe(false);
  });

  it('单码精确命中', () => {
    expect(hasPermission('system:user:delete', ['system:user:view', 'system:user:delete'])).toBe(true);
    expect(hasPermission('system:user:delete', ['system:user:view'])).toBe(false);
  });

  it('用户码段通配命中', () => {
    expect(hasPermission('system:user:delete', ['system:user:*'])).toBe(true);
    expect(hasPermission('system:user:delete', ['*'])).toBe(true);
    expect(hasPermission('system:user:delete', ['system:role:*'])).toBe(false);
  });

  it('数组 permission 为 any 语义（任一命中即渲染）', () => {
    expect(
      hasPermission(['a:b:c', 'x:y:z'], ['x:y:z'])
    ).toBe(true);
    expect(
      hasPermission(['a:b:c', 'x:y:z'], ['a:*'])
    ).toBe(true);
    expect(
      hasPermission(['a:b:c', 'x:y:z'], ['nope'])
    ).toBe(false);
  });

  it('空数组 permission 视为无要求', () => {
    expect(hasPermission([], ['whatever'])).toBe(true);
    expect(hasPermission([], [])).toBe(true);
  });
});
