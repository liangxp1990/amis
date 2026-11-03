/**
 * 权限码匹配与判定（供 SchemaRenderer 渲染前的权限拦截使用）。
 *
 * What: 组件 schema 上的 permission 字段声明"渲染此组件需要什么权限"，
 *   env.permissionCodes 声明"当前用户持有哪些权限码"；用户权限码支持
 *   通配符——`*` 匹配一切（超管），`system:user:*` 匹配 `system:user`
 *   前缀下所有操作（含 `system:user` 本身）。env.checkPermission 存在时
 *   覆盖内置判定，宿主可自定义语义（角色/动态规则等）。
 */

/**
 * 判断用户持有的单个权限码 pattern 是否覆盖组件要求的权限码 target。
 * What: 精确相等、`*` 全量通配、`xxx:*` 段前缀通配（target 等于去通配段
 *   的前缀，或以 `前缀:` 开头）。
 * Args: pattern - 用户权限码（可含 *）; target - 组件要求的权限码
 * Returns: 覆盖返回 true
 */
export function matchPermission(pattern: string, target: string): boolean {
  if (pattern === target) {
    return true;
  }
  if (pattern === '*') {
    return true;
  }
  if (pattern.endsWith(':*')) {
    const prefix = pattern.slice(0, -1); // 'system:user:*' → 'system:user:'
    const bare = pattern.slice(0, -2); // 'system:user:*' → 'system:user'
    return target.startsWith(prefix) || target === bare;
  }
  return false;
}

/**
 * 判定组件的 permission 配置是否被用户权限码集合满足。
 * What: permission 为数组时任一码被覆盖即通过（any 语义）；集合中任一
 *   用户码（含通配）可覆盖即通过；permissionCodes 为空数组时不通过，
 *   为 undefined（宿主未配置权限体系）时不拦截。
 * Args: permission - 组件配置的权限码（string | string[]）;
 *   permissionCodes - 当前用户权限码集合
 * Returns: 通过返回 true；未通过（应不渲染）返回 false
 */
export function hasPermission(
  permission: string | string[] | undefined,
  permissionCodes: Array<string> | undefined
): boolean {
  if (permission == null) {
    return true;
  }
  const required = Array.isArray(permission) ? permission : [permission];
  if (!required.length) {
    return true;
  }
  if (!Array.isArray(permissionCodes)) {
    // 宿主未接入权限体系：不做拦截（保持无权限配置时的行为）
    return true;
  }
  return required.some(target =>
    permissionCodes.some(pattern => matchPermission(pattern, target))
  );
}
