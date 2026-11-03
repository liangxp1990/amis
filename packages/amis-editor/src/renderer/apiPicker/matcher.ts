// packages/amis-editor/src/renderer/apiPicker/matcher.ts
import type {ApiItem} from './types';

/**
 * 按关键词模糊匹配接口列表（名称与路径，忽略大小写）。
 * What: startsWith 命中优先于 includes 命中，同组保持原顺序；路径用
 *   prefix+path 完整形式参与匹配——回填后的 url（如 /api/user/create）才能
 *   重新匹配到无前缀的候选（/user/create），保证"选中后再聚焦"仍能联想。
 * Args: items - 全量接口列表; keyword - 输入关键词（原样或剥离 method 前缀后）
 * Returns: 匹配项（未截断，截断由 UI 层负责）
 */
export function fuzzyMatchApi(items: ApiItem[], keyword: string): ApiItem[] {
  const kw = (keyword || '').trim().toLowerCase();
  if (!kw) {
    return items;
  }

  const starts: ApiItem[] = [];
  const contains: ApiItem[] = [];
  items.forEach(item => {
    const name = item.name.toLowerCase();
    const path = `${item.prefix || ''}${item.path}`.toLowerCase();
    if (name.startsWith(kw) || path.startsWith(kw)) {
      starts.push(item);
    } else if (name.includes(kw) || path.includes(kw)) {
      contains.push(item);
    }
  });
  return starts.concat(contains);
}
