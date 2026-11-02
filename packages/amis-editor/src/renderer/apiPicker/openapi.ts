// packages/amis-editor/src/renderer/apiPicker/openapi.ts
import type {ApiItem, ApiParam} from './types';

/** OpenAPI 规范有效 HTTP 方法（paths 下其余键如 parameters/servers 忽略） */
const HTTP_METHODS = [
  'get',
  'post',
  'put',
  'delete',
  'patch',
  'head',
  'options',
  'trace'
];

/** schema 属性树下钻的最大深度：允许 depth 0-5 共 6 层，第 6 层起（depth > 5）截断，兜底防组合 $ref 环栈溢出 */
const MAX_SCHEMA_DEPTH = 5;

/**
 * 解析 OpenAPI 3.0 文档为统一接口列表。
 * Args: doc - OpenAPI 文档对象（detect 命中层）
 * Returns: 接口列表；paths 缺失/非法返回空数组
 */
export function parseOpenApi3(doc: any): ApiItem[] {
  const servers = doc?.servers;
  const url = servers?.[0]?.url;
  return parsePaths(doc, typeof url === 'string' ? url : '');
}

/**
 * 解析 Swagger 2.0 文档为统一接口列表。
 * 与 3.0 的差异：前缀取 basePath；body 定义用 in:body 参数 + definitions。
 * Args: doc - Swagger 文档对象（detect 命中层）
 * Returns: 接口列表；paths 缺失/非法返回空数组
 */
export function parseSwagger2(doc: any): ApiItem[] {
  const basePath = doc?.basePath;
  return parsePaths(doc, typeof basePath === 'string' ? basePath : '');
}

/** 遍历 paths，每个 path × method 生成一个 ApiItem */
function parsePaths(doc: any, prefix: string): ApiItem[] {
  const paths = doc?.paths;
  if (!paths || typeof paths !== 'object') {
    return [];
  }

  const items: ApiItem[] = [];
  Object.keys(paths).forEach(path => {
    const pathItem = paths[path];
    if (!pathItem || typeof pathItem !== 'object') {
      return;
    }
    HTTP_METHODS.forEach(method => {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') {
        return;
      }
      items.push(toApiItem(doc, prefix, path, method, operation, pathItem));
    });
  });
  return items;
}

/** 单个 operation → ApiItem（合并 pathItem 级与 operation 级 parameters） */
function toApiItem(
  doc: any,
  prefix: string,
  path: string,
  method: string,
  operation: any,
  pathItem: any
): ApiItem {
  const pathParams: ApiParam[] = [];
  const queryParams: ApiParam[] = [];
  let bodyParams: ApiParam[] = [];

  const parameters = dedupeParameters(
    ([] as any[]).concat(pathItem.parameters || [], operation.parameters || [])
  );
  let bodySchema: any = null;

  parameters.forEach((p: any) => {
    if (p.in === 'path') {
      pathParams.push(operationParamToApiParam(p));
    } else if (p.in === 'query') {
      queryParams.push(operationParamToApiParam(p));
    } else if (p.in === 'body') {
      // Swagger 2.0 的 body 定义
      bodySchema = p.schema;
    }
  });

  // OpenAPI 3.0 的 requestBody（可为 $ref 指向 #/components/requestBodies，先 resolveRef；
  // application/json 优先，无则取第一个 content 条目）
  const requestBody = resolveRef(doc, operation?.requestBody);
  const content = requestBody?.content;
  if (content && typeof content === 'object') {
    bodySchema =
      content['application/json']?.schema ??
      content[Object.keys(content)[0]]?.schema ??
      bodySchema;
  }
  if (bodySchema) {
    bodyParams = schemaToParams(doc, bodySchema, '', 0);
  }

  return {
    name: operation.summary || operation.operationId || path,
    method,
    path,
    // 前缀为空时不写键（prefix?: 可选语义，toEqual 不忽略空串）
    ...(prefix ? {prefix} : {}),
    tags: Array.isArray(operation.tags) ? operation.tags : undefined,
    queryParams: queryParams.length ? queryParams : undefined,
    pathParams: pathParams.length ? pathParams : undefined,
    bodyParams: bodyParams.length ? bodyParams : undefined
  };
}

/** OpenAPI parameter 对象（in: path / in: query）→ ApiParam */
function operationParamToApiParam(p: any): ApiParam {
  const schema = p.schema;
  const enumVals = Array.isArray(p.enum)
    ? p.enum
    : Array.isArray(schema?.enum)
    ? schema.enum
    : undefined;
  return {
    name: p.name ?? '',
    path: p.name ?? '',
    type: schema?.type ?? p.type,
    // 未声明 required 时存 undefined（非 false），与测试期望的"缺省键"语义一致
    required: p.required ?? undefined,
    enum: enumVals as Array<string | number> | undefined,
    description: p.description
  };
}

/**
 * 参数列表按 (name, in) 去重，后出现的覆盖先出现的（operation 级覆盖 pathItem 级）。
 * What: OpenAPI 允许 operation 级覆盖 pathItem 级同名同位置的参数定义，
 *   直接 concat 会两份都保留导致重复；同时过滤非法项（非对象）。
 * Args: params - 拼接后的参数列表（pathItem 级在前，operation 级在后）
 * Returns: 去重后的列表，保持各 (name, in) 首次出现的位置顺序
 */
function dedupeParameters(params: any[]): any[] {
  const seen = new Map<string, any>();
  const order: string[] = [];
  params.forEach(p => {
    if (!p || typeof p !== 'object') {
      return;
    }
    const key = `${p.in ?? ''}:${p.name ?? ''}`;
    if (!seen.has(key)) {
      order.push(key);
    }
    seen.set(key, p);
  });
  return order.map(key => seen.get(key));
}

/**
 * 合并 allOf 组合 schema（最小实现）。
 * What: schema 含 allOf 数组时，各子 schema（各自 resolveRef）的 properties/required
 *   合并进当前 schema 自身的 properties/required（两者同时存在则都保留，同名属性后者
 *   覆盖；required 取并集）；oneOf/anyOf 组合不支持（后续文档声明限制）。
 * Args: doc - 文档（$ref 查找根）; resolved - resolveRef 后的 schema 节点
 * Returns: 合并后的 schema 对象（浅拷贝）；无 allOf 或非数组时原样返回
 */
function mergeAllOf(doc: any, resolved: any): any {
  if (!resolved || !Array.isArray(resolved.allOf) || !resolved.allOf.length) {
    return resolved;
  }
  const props: Record<string, any> = {...resolved.properties};
  const required = new Set<string>(
    Array.isArray(resolved.required) ? resolved.required : []
  );
  resolved.allOf.forEach((sub: any) => {
    const subResolved = resolveRef(doc, sub);
    if (!subResolved || typeof subResolved !== 'object') {
      return;
    }
    Object.assign(props, subResolved.properties);
    if (Array.isArray(subResolved.required)) {
      subResolved.required.forEach((key: string) => required.add(key));
    }
  });
  return {...resolved, properties: props, required: [...required]};
}

/**
 * schema（可含 $ref）→ 参数属性树。
 * What: 解析 object schema 的 properties（allOf 组合先合并，见 mergeAllOf）；
 *   嵌套 object 下钻为 children，完整路径记为 a.b；
 *   超过 MAX_SCHEMA_DEPTH 截断（组合 $ref 环兜底）。
 * Args: doc - 完整文档（$ref 指针查找根）; schema - 待解析 schema;
 *   parentPath - 父属性路径; depth - 当前深度
 * Returns: 属性参数列表；非 object/无 properties 返回空数组
 */
function schemaToParams(
  doc: any,
  schema: any,
  parentPath: string,
  depth: number
): ApiParam[] {
  if (depth > MAX_SCHEMA_DEPTH) {
    return [];
  }
  const resolved = resolveRef(doc, schema);
  const merged = mergeAllOf(doc, resolved);
  const props = merged?.properties;
  if (!props || typeof props !== 'object') {
    return [];
  }

  const requiredKeys = new Set<string>(
    Array.isArray(merged.required) ? merged.required : []
  );

  return Object.keys(props).map(key => {
    const prop = resolveRef(doc, props[key]);
    const fullPath = parentPath ? `${parentPath}.${key}` : key;
    const param: ApiParam = {
      name: key,
      path: fullPath,
      type: prop?.type,
      required: requiredKeys.has(key) || undefined,
      enum: Array.isArray(prop?.enum) ? prop.enum : undefined,
      description: prop?.description
    };
    if (prop?.type === 'object') {
      const children = schemaToParams(doc, props[key], fullPath, depth + 1);
      if (children.length) {
        param.children = children;
      }
    }
    return param;
  });
}

/**
 * 解析 $ref 引用链（#/components/schemas/X 或 #/definitions/X）。
 * What: 迭代解引用直到非 $ref 节点。环防护分两层：本函数只拦截"单条 $ref→$ref
 *   链"内的环（返回 null）；属性树嵌套的组合环（A.b→B、B.a→A）由
 *   schemaToParams 的 MAX_SCHEMA_DEPTH 递归上限兜底截断。
 * Args: doc - 文档; node - 可能含 $ref 的节点
 * Returns: 解析后的 schema 对象；查找失败/链环返回 null
 */
function resolveRef(doc: any, node: any): any {
  let current = node;
  const chainSeen = new Set<string>();

  while (
    current &&
    typeof current === 'object' &&
    typeof current.$ref === 'string'
  ) {
    const ref = current.$ref;
    if (chainSeen.has(ref)) {
      return null;
    }
    chainSeen.add(ref);
    current = lookupPointer(doc, ref);
  }
  return current && typeof current === 'object' ? current : null;
}

/** 按 JSON Pointer（#/a/b）查找文档节点；任一段缺失返回 null */
function lookupPointer(doc: any, ref: string): any {
  const segments = ref.replace(/^#\//, '').split('/');
  let target: any = doc;
  for (const seg of segments) {
    target = target?.[unescapePointer(seg)];
    if (target == null) {
      return null;
    }
  }
  return target;
}

/**
 * 反转义单个 JSON Pointer 段（RFC 6901）并容错解码 percent-encoding。
 * What: ~1 → /、~0 → ~（~1 必须先于 ~0 还原，保证 ~01 正确得到字面量 ~1）；
 *   部分工具产出的 percent-encoding 用 decodeURIComponent 解码，解码失败时
 *   保留原值（容错）。
 * Args: seg - 指针原始段
 * Returns: 反转义后的段
 */
function unescapePointer(seg: string): string {
  let s = seg.replace(/~1/g, '/').replace(/~0/g, '~');
  try {
    s = decodeURIComponent(s);
  } catch (e) {
    // 序列非法（如孤立的 %）：保留原值
  }
  return s;
}
