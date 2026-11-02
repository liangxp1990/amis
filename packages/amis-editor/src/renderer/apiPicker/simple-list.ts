// packages/amis-editor/src/renderer/apiPicker/simple-list.ts
import type {ApiItem} from './types';

/**
 * 解析简单 items 列表格式：{items: [{name, method, url, ...api定义}]}。
 * What: 项内 url 归一映射到 ApiItem.path（不做前缀拼接，所见即所得）；
 *   name/method/url 之外的 api 定义字段放入 extra，选中回填时透传。
 * Args: body - detect 命中层的响应体
 * Returns: 接口列表；items 非数组或缺 url 的项被过滤
 */
export function parseSimpleList(body: any): ApiItem[] {
  const items = body?.items;
  if (!Array.isArray(items)) {
    return [];
  }

  return items
    .filter(item => item && typeof item === 'object' && typeof item.url === 'string')
    .map(item => {
      const {name, method, url, ...extra} = item;
      return {
        name: typeof name === 'string' && name ? name : url,
        method:
          typeof method === 'string' && method ? method.toLowerCase() : 'get',
        path: url,
        extra: Object.keys(extra).length ? extra : undefined
      };
    });
}
