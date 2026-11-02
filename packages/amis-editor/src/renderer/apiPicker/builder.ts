// packages/amis-editor/src/renderer/apiPicker/builder.ts
import type {ApiItem, ApiParam} from './types';
import type {Api} from 'amis-core'; // 仅类型，swc 擦除，无运行时依赖

/**
 * url 前缀拼接并去重中间斜杠。
 * Why: springdoc 的 servers[0].url 常以 / 结尾而 path 以 / 开头，直接拼接产生 //。
 * Args: prefix - url 前缀（servers url / basePath，空/未定义时原样返回 path）; path - 原始路径
 * Returns: 拼接后的 url，中间仅保留单个斜杠
 */
export function joinUrl(prefix: string | undefined, path: string): string {
  if (!prefix) {
    return path;
  }
  return `${prefix.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

/**
 * 参数树 → data 映射模板。
 * What: 每个叶子参数生成 {参数名: '${完整路径}'}；嵌套 object 保留结构。
 * Args: params - 参数树（queryParams/bodyParams，可含 children 嵌套）
 * Returns: 映射对象；参数为空返回 undefined
 */
function paramsToData(params?: ApiParam[]): Record<string, any> | undefined {
  if (!params || !params.length) {
    return undefined;
  }
  const data: Record<string, any> = {};
  params.forEach(p => {
    if (p.children && p.children.length) {
      data[p.name] = paramsToData(p.children);
    } else {
      data[p.name] = `\${${p.path || p.name}}`;
    }
  });
  return data;
}

/**
 * 选中接口项生成回填的 api 对象（入参自动化）。
 * What: 前缀拼接 + path 参数替换为 ${name} 占位；query/body 参数合并生成
 *   data 映射模板（body 与 query 同名时 body 覆盖）；extra 字段深拷贝透传，
 *   extra 若含 data/headers 键则整体覆盖（Object.assign 在后，简单列表宿主
 *   自定义的 api 定义优先于自动生成的参数模板）。
 * Args: item - 解析器输出的统一接口模型
 * Returns: 标准 Api 对象（含 method/url，有参数时含 data）
 */
export function buildApiFromItem(item: ApiItem): Api {
  let url = joinUrl(item.prefix, item.path);
  (item.pathParams || []).forEach(p => {
    // 函数替换：避免参数名含 $&/$' 等特殊串时被替换串展开语义改写
    url = url.replace(`{${p.name}}`, () => `\${${p.name}}`);
  });

  const data = {
    ...paramsToData(item.queryParams),
    ...paramsToData(item.bodyParams)
  };

  const api: any = {method: item.method, url};
  if (Object.keys(data).length) {
    api.data = data;
  }
  if (item.extra) {
    Object.assign(api, JSON.parse(JSON.stringify(item.extra)));
  }
  return api as Api;
}
