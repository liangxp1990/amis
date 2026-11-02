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
  'options'
];

/** schema 属性树下钻的最大深度：兜底截断组合 $ref 环，防栈溢出 */
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

  const parameters = ([] as any[]).concat(
    pathItem.parameters || [],
    operation.parameters || []
  );
  let bodySchema: any = null;

  parameters.forEach((p: any) => {
    if (!p || typeof p !== 'object') {
      return;
    }
    if (p.in === 'path') {
      pathParams.push(operationParamToApiParam(p));
    } else if (p.in === 'query') {
      queryParams.push(operationParamToApiParam(p));
    } else if (p.in === 'body') {
      // Swagger 2.0 的 body 定义
      bodySchema = p.schema;
    }
  });

  // OpenAPI 3.0 的 requestBody（application/json 优先，无则取第一个 content 条目）
  const content = operation?.requestBody?.content;
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
 * schema（可含 $ref）→ 参数属性树。
 * What: 解析 object schema 的 properties；嵌套 object 下钻为 children，
 *   完整路径记为 a.b；超过 MAX_SCHEMA_DEPTH 截断（组合 $ref 环兜底）。
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
  const props = resolved?.properties;
  if (!props || typeof props !== 'object') {
    return [];
  }

  const requiredKeys = new Set<string>(
    Array.isArray(resolved.required) ? resolved.required : []
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

  while (current && typeof current === 'object' && typeof current.$ref === 'string') {
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
    target = target?.[seg];
    if (target == null) {
      return null;
    }
  }
  return target;
}
