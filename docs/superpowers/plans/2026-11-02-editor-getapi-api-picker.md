# amis 编辑器 getApi 全局接口选择 实现计划

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 宿主在编辑器全局配置 `getApi`（指向 OpenAPI 3.0/Swagger 2.0 文档或简单 items 列表）后，API 配置控件（`ae-apiControl`，覆盖所有通用 API/Service 配置）支持联想下拉选择接口并自动回填真实 API 对象与入参模板；未配置则行为零变化。

**Architecture:** 新增纯函数模块 `packages/amis-editor/src/renderer/apiPicker/`（类型/格式探测/OpenAPI 解析/入参生成/模糊匹配/带负缓存的加载器，零包运行时依赖、全部可单测）；`EditorProps.getApi` 类型声明随现有 `EditorProps → EditorManagerConfig → getEnv(window.editorStore)` 链路自动下发；APIControl 增加轻量联想下拉层（自实现，富展示 method 徽标+名称+path+tags 分组）。

**Tech Stack:** TypeScript / React class component / jest（根配置 `@swc/jest`，`testRegex` 直接拾取本包测试）/ scss（追加至 amis-editor-core）

**Spec:** `docs/design.md`（已评审通过）

**约定（全任务通用）:**
- 所有测试命令在仓库根目录执行：`./node_modules/.bin/jest <相对路径>`
- 本包测试**不要**用 `npm test --workspace amis-editor`（其 test script 为占位）
- apiPicker 模块内**禁止**运行时 import 任何包（`amis`/`amis-core`/`amis-ui`/`amis-editor-core`）——只允许 `import type`（swc 擦除，保证 jest 无需 moduleNameMapper 即可运行）；外部依赖（fetcher/notify）一律参数注入
- 注释按仓库规范：What/Args/Returns/边界
- 模型命名与 spec（docs/design.md 3.2 节草案）的映射：spec `bodySchema` → 计划 `bodyParams`；另计划增加 `prefix`（url 前缀）、`path`（原始路径）、`extra`（简单列表透传字段）字段，语义一致仅命名细化

---

## Chunk 1: apiPicker 纯函数模块（Task 1-7）

### Task 1: 公共类型 + 格式探测

**Files:**
- Create: `packages/amis-editor/src/renderer/apiPicker/types.ts`
- Create: `packages/amis-editor/src/renderer/apiPicker/detect.ts`
- Test: `packages/amis-editor/src/renderer/apiPicker/__tests__/detect.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/amis-editor/src/renderer/apiPicker/__tests__/detect.test.ts
import {detectApiSource} from '../detect';

describe('apiPicker: detectApiSource', () => {
  // 裸文档在 res.data（仓库默认 fetcher：直接返回 axios response）
  it('探测 res.data 层的 OpenAPI 3.0', () => {
    const res = {data: {openapi: '3.0.1', paths: {}}};
    expect(detectApiSource(res)).toEqual({kind: 'openapi3', body: res.data});
  });

  it('探测 res.data 层的 Swagger 2.0', () => {
    const res = {data: {swagger: '2.0', paths: {}}};
    expect(detectApiSource(res)).toEqual({kind: 'swagger2', body: res.data});
  });

  // 按 amis 协议解包的宿主 fetcher：文档在 res.data.data
  it('探测 res.data.data 层的 OpenAPI（宿主 fetcher 已解包）', () => {
    const res = {data: {status: 0, data: {openapi: '3.0.1', paths: {}}}};
    expect(detectApiSource(res)).toEqual({kind: 'openapi3', body: res.data.data});
  });

  it('探测 res.data.data 层的简单列表（已解包）', () => {
    const res = {data: {status: 0, data: {items: [{name: 'a', method: 'get', url: '/a'}]}}};
    expect(detectApiSource(res)).toEqual({kind: 'simple', body: res.data.data});
  });

  // res.data 是标准 amis 响应但内层无已知结构 → 视为文档在 data.data 层探测失败
  it('res.data 优先：两层都像已知结构时取先命中的外层', () => {
    const res = {data: {swagger: '2.0', paths: {}, data: {items: []}}};
    expect(detectApiSource(res)?.kind).toBe('swagger2');
  });

  it('两层均未命中返回 null', () => {
    expect(detectApiSource({data: {status: 0, data: {foo: 1}}})).toBeNull();
    expect(detectApiSource({data: null})).toBeNull();
    expect(detectApiSource(undefined)).toBeNull();
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/detect.test.ts`
Expected: FAIL `Cannot find module '../detect'`

- [ ] **Step 3: 实现 types.ts 与 detect.ts**

```ts
// packages/amis-editor/src/renderer/apiPicker/types.ts
/**
 * apiPicker 模块公共类型：各解析器的统一内部模型。
 * 本模块零包运行时依赖，外部能力（fetcher/notify）由调用方注入。
 */

/** 单个接口参数定义（来自 OpenAPI parameter 或 requestBody schema 属性） */
export interface ApiParam {
  /** 参数名 */
  name: string;
  /** 完整路径，嵌套属性为 a.b 形式；顶层同 name */
  path?: string;
  /** 参数类型：string/integer/boolean/object 等 */
  type?: string;
  /** 是否必填（schema required 或父级必填传导） */
  required?: boolean;
  /** 可选值（OpenAPI enum） */
  enum?: Array<string | number>;
  /** 参数说明 */
  description?: string;
  /** 嵌套对象属性（type 为 object 时下钻一层） */
  children?: ApiParam[];
}

/** 统一接口模型：所有解析器的输出、联想下拉与入参生成的输入 */
export interface ApiItem {
  /** 显示名：OpenAPI summary > operationId > path；简单列表 name > url */
  name: string;
  /** 请求方法（小写） */
  method: string;
  /** 原始路径（可含 {id} 占位），不含前缀 */
  path: string;
  /** url 前缀：OpenAPI3 servers[0].url / Swagger2 basePath；简单列表无 */
  prefix?: string;
  /** OpenAPI tags，用于下拉分组 */
  tags?: string[];
  /** query 参数（in: query） */
  queryParams?: ApiParam[];
  /** path 参数（in: path，生成 ${name} 占位） */
  pathParams?: ApiParam[];
  /** body 参数（requestBody / in:body schema 的属性树） */
  bodyParams?: ApiParam[];
  /** 简单列表项透传的 api 定义字段（data/headers 等），选中回填时并入 */
  extra?: Record<string, any>;
}

/** 数据源格式 */
export type ApiSourceKind = 'openapi3' | 'swagger2' | 'simple';
```

```ts
// packages/amis-editor/src/renderer/apiPicker/detect.ts
import type {ApiSourceKind} from './types';

/** 探测结果：格式 + 命中层的 body 引用（供解析器直接使用） */
export interface DetectedSource {
  kind: ApiSourceKind;
  body: any;
}

/**
 * 探测 fetcher 响应中的接口定义格式。
 * What: 兼容两类宿主 fetcher——仓库默认 fetcher 直接返回 axios response（裸文档在
 *   res.data），按 amis 协议解包的 fetcher（裸文档在 res.data.data），两层依次检查。
 * Args: response - env.fetcher 的返回值
 * Returns: {kind, body}；两层均未命中已知结构返回 null（视为非法响应，走降级）
 */
export function detectApiSource(response: any): DetectedSource | null {
  const layers = [response?.data, response?.data?.data];

  for (const body of layers) {
    if (!body || typeof body !== 'object') {
      continue;
    }
    if (typeof body.openapi === 'string') {
      return {kind: 'openapi3', body};
    }
    if (typeof body.swagger === 'string') {
      return {kind: 'swagger2', body};
    }
    if (Array.isArray(body.items)) {
      return {kind: 'simple', body};
    }
  }
  return null;
}
```

- [ ] **Step 4: 运行确认通过**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/detect.test.ts`
Expected: PASS（6 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/amis-editor/src/renderer/apiPicker/
git commit -m "feat(amis-editor): apiPicker 格式探测与公共类型"
```

---

### Task 2: OpenAPI 3.0 解析器

**Files:**
- Create: `packages/amis-editor/src/renderer/apiPicker/openapi.ts`
- Test: `packages/amis-editor/src/renderer/apiPicker/__tests__/openapi.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/amis-editor/src/renderer/apiPicker/__tests__/openapi.test.ts
import {parseOpenApi3, parseSwagger2} from '../openapi';

/** 最小可用的 OpenAPI 3.0 文档 */
function openApi3Doc(): any {
  return {
    openapi: '3.0.1',
    servers: [{url: '/api'}],
    paths: {
      '/user/list': {
        get: {
          summary: '获取用户列表',
          tags: ['用户管理'],
          parameters: [
            {name: 'pageNum', in: 'query', required: true, schema: {type: 'integer'}},
            {name: 'keyword', in: 'query', schema: {type: 'string'}, description: '搜索词'}
          ]
        }
      },
      '/user/{id}': {
        parameters: [{name: 'id', in: 'path', required: true, schema: {type: 'string'}}],
        get: {
          operationId: 'getUserDetail',
          parameters: [{name: 'verbose', in: 'query', schema: {type: 'boolean'}}]
        }
      },
      '/user/create': {
        post: {
          summary: '创建用户',
          requestBody: {
            content: {
              'application/json': {
                schema: {$ref: '#/components/schemas/UserCreateReq'}
              }
            }
          }
        }
      },
      '/user/import': {
        post: {
          summary: '导入用户',
          requestBody: {
            content: {'application/json': {schema: {$ref: '#/components/schemas/DeepReq'}}}
          }
        }
      }
    },
    components: {
      schemas: {
        UserCreateReq: {
          type: 'object',
          required: ['name'],
          properties: {
            name: {type: 'string', description: '用户名'},
            role: {type: 'string', enum: ['admin', 'user']},
            profile: {
              type: 'object',
              properties: {address: {type: 'string'}, city: {type: 'string'}}
            }
          }
        },
        // 组合环：A.b → B，B.a → A
        DeepReq: {
          type: 'object',
          properties: {
            b: {$ref: '#/components/schemas/LoopB'},
            plain: {type: 'string'}
          }
        },
        LoopB: {
          type: 'object',
          properties: {a: {$ref: '#/components/schemas/DeepReq'}}
        }
      }
    }
  };
}

describe('apiPicker: parseOpenApi3', () => {
  it('遍历 paths，每个 path × method 一项，取 servers[0].url 为前缀', () => {
    const items = parseOpenApi3(openApi3Doc());
    expect(items).toHaveLength(4);
    expect(items[0]).toMatchObject({
      name: '获取用户列表',
      method: 'get',
      path: '/user/list',
      prefix: '/api',
      tags: ['用户管理'],
      queryParams: [
        {name: 'pageNum', type: 'integer', required: true},
        {name: 'keyword', type: 'string', description: '搜索词'}
      ]
    });
  });

  it('无 summary 时依次回退 operationId / path', () => {
    const items = parseOpenApi3(openApi3Doc());
    const detail = items.find(i => i.path === '/user/{id}')!;
    expect(detail.name).toBe('getUserDetail');
    expect(detail.pathParams).toEqual([
      {name: 'id', type: 'string', required: true, path: 'id'}
    ]);
  });

  it('pathItem 级与 operation 级 parameters 合并', () => {
    const detail = parseOpenApi3(openApi3Doc()).find(i => i.path === '/user/{id}')!;
    expect(detail.queryParams).toEqual([
      {name: 'verbose', type: 'boolean', path: 'verbose'}
    ]);
  });

  it('$ref 递归解析 requestBody：required/enum/description/嵌套对象下钻', () => {
    const create = parseOpenApi3(openApi3Doc()).find(i => i.path === '/user/create')!;
    expect(create.bodyParams).toEqual([
      {name: 'name', path: 'name', type: 'string', required: true, description: '用户名'},
      {name: 'role', path: 'role', type: 'string', enum: ['admin', 'user']},
      {
        name: 'profile',
        path: 'profile',
        type: 'object',
        children: [
          {name: 'address', path: 'profile.address', type: 'string'},
          {name: 'city', path: 'profile.city', type: 'string'}
        ]
      }
    ]);
  });

  it('组合 $ref 环不栈溢出（深度限制截断）', () => {
    const importItem = parseOpenApi3(openApi3Doc()).find(i => i.path === '/user/import')!;
    expect(Array.isArray(importItem.bodyParams)).toBe(true);
    expect(importItem.bodyParams!.length).toBeGreaterThan(0);
  });

  it('paths 缺失或非法时返回空数组', () => {
    expect(parseOpenApi3({openapi: '3.0.1'})).toEqual([]);
    expect(parseOpenApi3(null)).toEqual([]);
  });
});

/** 最小可用的 Swagger 2.0 文档 */
function swagger2Doc(): any {
  return {
    swagger: '2.0',
    basePath: '/api',
    paths: {
      '/pet': {
        post: {
          summary: '新增宠物',
          parameters: [
            {name: 'body', in: 'body', schema: {$ref: '#/definitions/Pet'}}
          ]
        }
      }
    },
    definitions: {
      Pet: {
        type: 'object',
        required: ['name'],
        properties: {name: {type: 'string'}, age: {type: 'integer'}}
      }
    }
  };
}

describe('apiPicker: parseSwagger2', () => {
  it('取 basePath 为前缀，in:body 参数经 definitions 解析', () => {
    const items = parseSwagger2(swagger2Doc());
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({name: '新增宠物', method: 'post', path: '/pet', prefix: '/api'});
    expect(items[0].bodyParams).toEqual([
      {name: 'name', path: 'name', type: 'string', required: true},
      {name: 'age', path: 'age', type: 'integer'}
    ]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/openapi.test.ts`
Expected: FAIL `Cannot find module '../openapi'`

- [ ] **Step 3: 实现 openapi.ts**

```ts
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
    prefix,
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
```

> jest 语义说明：`toEqual` 递归忽略值为 `undefined` 的属性，故实现中 `required: p.required ?? undefined` 与测试期望里"未写 required 键"等价；pathParams 期望中显式写 `required: true` 的项不受影响。

- [ ] **Step 4: 运行确认通过**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/openapi.test.ts`
Expected: PASS（7 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/amis-editor/src/renderer/apiPicker/
git commit -m "feat(amis-editor): OpenAPI 3.0/Swagger 2.0 接口列表解析器"
```

---

### Task 3: 简单列表解析器

**Files:**
- Create: `packages/amis-editor/src/renderer/apiPicker/simple-list.ts`
- Test: `packages/amis-editor/src/renderer/apiPicker/__tests__/simple-list.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/amis-editor/src/renderer/apiPicker/__tests__/simple-list.test.ts
import {parseSimpleList} from '../simple-list';

describe('apiPicker: parseSimpleList', () => {
  it('url 归一映射到 path，多余字段进 extra，name 缺省用 url', () => {
    const items = parseSimpleList({
      items: [
        {name: '用户列表', method: 'GET', url: '/api/user', data: {a: '${a}'}},
        {url: '/api/orphan'}
      ]
    });
    expect(items).toEqual([
      {
        name: '用户列表',
        method: 'get',
        path: '/api/user',
        extra: {data: {a: '${a}'}}
      },
      {name: '/api/orphan', method: 'get', path: '/api/orphan'}
    ]);
  });

  it('缺少 url 的项被过滤；items 非法返回空数组', () => {
    expect(parseSimpleList({items: [{name: 'x'}]})).toEqual([]);
    expect(parseSimpleList({})).toEqual([]);
    expect(parseSimpleList(null)).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/simple-list.test.ts`
Expected: FAIL `Cannot find module '../simple-list'`

- [ ] **Step 3: 实现 simple-list.ts**

```ts
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
```

- [ ] **Step 4: 运行确认通过**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/simple-list.test.ts`
Expected: PASS（2 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/amis-editor/src/renderer/apiPicker/
git commit -m "feat(amis-editor): 简单 items 列表解析器"
```

---

### Task 4: 入参自动化生成器

**Files:**
- Create: `packages/amis-editor/src/renderer/apiPicker/builder.ts`
- Test: `packages/amis-editor/src/renderer/apiPicker/__tests__/builder.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/amis-editor/src/renderer/apiPicker/__tests__/builder.test.ts
import {buildApiFromItem, joinUrl} from '../builder';
import type {ApiItem} from '../types';

describe('apiPicker: joinUrl 前缀拼接', () => {
  it('常规拼接', () => {
    expect(joinUrl('/api', '/user/list')).toBe('/api/user/list');
  });

  it('去重中间斜杠（springdoc servers url 常以 / 结尾）', () => {
    expect(joinUrl('/api/', '/user/list')).toBe('/api/user/list');
    expect(joinUrl('http://host/api//', '//user')).toBe('http://host/api/user');
  });

  it('前缀为空返回原 path', () => {
    expect(joinUrl('', '/user')).toBe('/user');
    expect(joinUrl(undefined as any, '/user')).toBe('/user');
  });
});

describe('apiPicker: buildApiFromItem 入参自动化', () => {
  it('path 参数替换为 ${name} 占位，前缀拼接', () => {
    const item: ApiItem = {
      name: '用户详情',
      method: 'get',
      path: '/user/{id}',
      prefix: '/api',
      pathParams: [{name: 'id', path: 'id', type: 'string', required: true}]
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'get',
      url: '/api/user/${id}'
    });
  });

  it('query 参数生成 data 映射（GET 时 amis 自动序列化为 query）', () => {
    const item: ApiItem = {
      name: '列表',
      method: 'get',
      path: '/user/list',
      queryParams: [
        {name: 'pageNum', path: 'pageNum', required: true},
        {name: 'keyword', path: 'keyword'}
      ]
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'get',
      url: '/user/list',
      data: {pageNum: '${pageNum}', keyword: '${keyword}'}
    });
  });

  it('body 参数生成嵌套 data 映射，占位用完整路径', () => {
    const item: ApiItem = {
      name: '创建',
      method: 'post',
      path: '/user/create',
      bodyParams: [
        {name: 'name', path: 'name', type: 'string', required: true},
        {
          name: 'profile',
          path: 'profile',
          type: 'object',
          children: [
            {name: 'city', path: 'profile.city', type: 'string'}
          ]
        }
      ]
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'post',
      url: '/user/create',
      data: {name: '${name}', profile: {city: '${profile.city}'}}
    });
  });

  it('简单列表 extra 透传且不污染缓存中的原对象', () => {
    const extra = {data: {a: 1}, headers: {'X-Token': 't'}};
    const item: ApiItem = {
      name: 'x',
      method: 'post',
      path: '/x',
      extra
    };
    const api: any = buildApiFromItem(item);
    expect(api.headers).toEqual({'X-Token': 't'});
    api.headers['X-Token'] = 'changed';
    expect(extra.headers['X-Token']).toBe('t');
  });

  it('extra 含 data 键时整体覆盖生成的参数映射（宿主自定义优先）', () => {
    const item: ApiItem = {
      name: 'x',
      method: 'post',
      path: '/x',
      queryParams: [{name: 'a', path: 'a'}],
      extra: {data: {custom: 1}}
    };
    expect(buildApiFromItem(item)).toEqual({
      method: 'post',
      url: '/x',
      data: {custom: 1}
    });
  });

  it('无参数时只含 method/url', () => {
    expect(
      buildApiFromItem({name: 'x', method: 'get', path: '/x'})
    ).toEqual({method: 'get', url: '/x'});
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/builder.test.ts`
Expected: FAIL `Cannot find module '../builder'`

- [ ] **Step 3: 实现 builder.ts**

```ts
// packages/amis-editor/src/renderer/apiPicker/builder.ts
import type {ApiItem, ApiParam} from './types';
import type {Api} from 'amis-core'; // 仅类型，swc 擦除，无运行时依赖

/**
 * url 前缀拼接并去重中间斜杠。
 * Why: springdoc 的 servers[0].url 常以 / 结尾而 path 以 / 开头，直接拼接产生 //。
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
    url = url.replace(`{${p.name}}`, `\${${p.name}}`);
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
```

- [ ] **Step 4: 运行确认通过**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/builder.test.ts`
Expected: PASS（9 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/amis-editor/src/renderer/apiPicker/
git commit -m "feat(amis-editor): 接口入参自动化生成器"
```

---

### Task 5: 模糊匹配

**Files:**
- Create: `packages/amis-editor/src/renderer/apiPicker/matcher.ts`
- Test: `packages/amis-editor/src/renderer/apiPicker/__tests__/matcher.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/amis-editor/src/renderer/apiPicker/__tests__/matcher.test.ts
import {fuzzyMatchApi} from '../matcher';
import type {ApiItem} from '../types';

const items: ApiItem[] = [
  {name: '获取用户列表', method: 'get', path: '/api/user/list'},
  {name: '创建用户', method: 'post', path: '/api/user/create'},
  {name: '订单详情', method: 'get', path: '/api/order/detail'}
];

describe('apiPicker: fuzzyMatchApi', () => {
  it('按名称或路径忽略大小写匹配', () => {
    expect(fuzzyMatchApi(items, 'USER')).toHaveLength(2); // 名称含"用户"不含 USER；路径含 user
    expect(fuzzyMatchApi(items, '用户')).toHaveLength(2);
    expect(fuzzyMatchApi(items, '/api/order')).toEqual([items[2]]);
  });

  it('前缀命中排在包含命中之前', () => {
    const list: ApiItem[] = [
      {name: '订单详情', method: 'get', path: '/b'},     // 名称前缀命中
      {name: 'x', method: 'get', path: '/订单/c'},       // 路径包含命中
      {name: '详情-订单', method: 'get', path: '/a'}     // 名称包含命中
    ];
    expect(fuzzyMatchApi(list, '订单')).toEqual([list[0], list[1], list[2]]);
    // '/订单' 仅命中路径前缀（注意 path 以 / 开头，'订单' 打头不会前缀命中）
    expect(fuzzyMatchApi(list, '/订单')).toEqual([list[1]]);
  });

  it('空关键词返回全部；无匹配返回空数组', () => {
    expect(fuzzyMatchApi(items, '')).toEqual(items);
    expect(fuzzyMatchApi(items, '  ')).toEqual(items);
    expect(fuzzyMatchApi(items, '不存在')).toEqual([]);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/matcher.test.ts`
Expected: FAIL `Cannot find module '../matcher'`

- [ ] **Step 3: 实现 matcher.ts**

```ts
// packages/amis-editor/src/renderer/apiPicker/matcher.ts
import type {ApiItem} from './types';

/**
 * 按关键词模糊匹配接口列表（名称与路径，忽略大小写）。
 * What: startsWith 命中优先于 includes 命中，同组保持原顺序。
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
    const path = item.path.toLowerCase();
    if (name.startsWith(kw) || path.startsWith(kw)) {
      starts.push(item);
    } else if (name.includes(kw) || path.includes(kw)) {
      contains.push(item);
    }
  });
  return starts.concat(contains);
}
```

- [ ] **Step 4: 运行确认通过**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/matcher.test.ts`
Expected: PASS（3 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/amis-editor/src/renderer/apiPicker/
git commit -m "feat(amis-editor): 接口列表模糊匹配"
```

---

### Task 6: 数据源加载与缓存（含负缓存 / toast 去重）

**Files:**
- Create: `packages/amis-editor/src/renderer/apiPicker/loader.ts`
- Test: `packages/amis-editor/src/renderer/apiPicker/__tests__/loader.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// packages/amis-editor/src/renderer/apiPicker/__tests__/loader.test.ts
import {loadApiItems, resetApiCache} from '../loader';
import type {ApiFetcher} from '../loader';

const openapiRes = {
  data: {openapi: '3.0.1', paths: {'/a': {get: {summary: 'A'}}}}
};

function makeFetcher(res: any, impl?: (api: any) => Promise<any>): ApiFetcher {
  return impl
    ? (impl as ApiFetcher)
    : async () => res;
}

beforeEach(() => {
  resetApiCache();
});

describe('apiPicker: loadApiItems', () => {
  it('拉取并按探测格式解析为接口列表', async () => {
    const items = await loadApiItems(
      '/v3/api-docs',
      makeFetcher(openapiRes)
    );
    expect(items).toEqual([
      {name: 'A', method: 'get', path: '/a'}
    ]);
  });

  it('同 getApi 配置多实例只请求一次（模块级缓存）', async () => {
    let calls = 0;
    const fetcher = makeFetcher(openapiRes, async () => {
      calls++;
      return openapiRes;
    });
    await loadApiItems('/v3/api-docs', fetcher);
    await loadApiItems('/v3/api-docs', fetcher);
    expect(calls).toBe(1);
  });

  it('不同 getApi 配置独立缓存', async () => {
    let calls = 0;
    const fetcher = makeFetcher(openapiRes, async () => {
      calls++;
      return openapiRes;
    });
    await loadApiItems('/a', fetcher);
    await loadApiItems('/b', fetcher);
    expect(calls).toBe(2);
  });

  it('请求失败：返回 null、负缓存（会话内不重试）、notify 收到 key', async () => {
    let calls = 0;
    const notify = jest.fn();
    const fetcher = makeFetcher(null, async () => {
      calls++;
      throw new Error('network');
    });
    expect(await loadApiItems('/bad', fetcher, notify)).toBeNull();
    expect(await loadApiItems('/bad', fetcher, notify)).toBeNull();
    expect(calls).toBe(1);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify).toHaveBeenCalledWith('apiControl.loadFailed');
  });

  it('响应非法（未知结构）：返回 null 且计入负缓存', async () => {
    const notify = jest.fn();
    const fetcher = makeFetcher({data: {status: 0, data: {foo: 1}}});
    expect(await loadApiItems('/x', fetcher, notify)).toBeNull();
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('失败 toast 全局去重：不同 getApi 的第二次失败不再 notify', async () => {
    const notify = jest.fn();
    await loadApiItems('/bad1', makeFetcher(null, async () => {throw 0;}), notify);
    await loadApiItems('/bad2', makeFetcher(null, async () => {throw 0;}), notify);
    expect(notify).toHaveBeenCalledTimes(1);
  });

  it('简单列表（已解包层）解析', async () => {
    const res = {data: {status: 0, data: {items: [{name: 'n', url: '/n'}]}}};
    const items = await loadApiItems('/list', makeFetcher(res));
    expect(items).toEqual([{name: 'n', method: 'get', path: '/n'}]);
  });

  it('并发首次加载共享同一次请求（in-flight 去重）', async () => {
    let calls = 0;
    const fetcher: ApiFetcher = async () => {
      calls++;
      await new Promise(resolve => setTimeout(resolve, 10));
      return openapiRes;
    };
    const [a, b] = await Promise.all([
      loadApiItems('/concurrent', fetcher),
      loadApiItems('/concurrent', fetcher)
    ]);
    expect(calls).toBe(1);
    expect(a).toEqual(b);
  });
});
```

- [ ] **Step 2: 运行确认失败**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/loader.test.ts`
Expected: FAIL `Cannot find module '../loader'`

- [ ] **Step 3: 实现 loader.ts**

```ts
// packages/amis-editor/src/renderer/apiPicker/loader.ts
import {detectApiSource} from './detect';
import {parseOpenApi3, parseSwagger2} from './openapi';
import {parseSimpleList} from './simple-list';
import type {ApiItem} from './types';

/**
 * env.fetcher 的最小签名（由 APIControl 注入，保持模块纯净可测）。
 */
export type ApiFetcher = (api: any, ctx?: any) => Promise<any>;

/** 失败提示的 i18n key（由 UI 层翻译后 toast） */
export const API_LOAD_FAILED_KEY = 'apiControl.loadFailed';

/**
 * 模块级缓存：存 Promise 而非结果——既缓存成功/失败（负缓存），
 * 也天然去重并发 in-flight 请求（编辑器内多实例同时首次加载只发一次）。
 * key 为 getApi 定义序列化。
 */
const cache = new Map<string, Promise<ApiItem[] | null>>();

/** 失败 toast 全局去重：编辑器会话内只提示一次 */
let failureNotified = false;

/** 缓存 key：字符串原样，对象 JSON 序列化 */
function cacheKey(getApi: any): string {
  if (typeof getApi === 'string') {
    return getApi;
  }
  try {
    return JSON.stringify(getApi);
  } catch (e) {
    return String(getApi);
  }
}

/** 清空模块级缓存与去重标记（测试用） */
export function resetApiCache(): void {
  cache.clear();
  failureNotified = false;
}

/**
 * 拉取并解析接口列表（模块级缓存共享：编辑器内多实例只请求一次）。
 * What: 命中缓存直接返回缓存 Promise；未命中发起加载并立即写入缓存
 *   （并发调用共享同一次请求）；失败结果 resolve 为 null 且同样缓存
 *   （负缓存，编辑器会话内不再重试）。
 * Args: getApi - 全局配置（SchemaApi）; fetcher - env.fetcher;
 *   notify - 失败提示回调（入参为 i18n key，全局去重一次）
 * Returns: 接口列表；失败/非法响应返回 null（调用方降级为普通手输）
 */
export function loadApiItems(
  getApi: any,
  fetcher: ApiFetcher,
  notify?: (key: string) => void
): Promise<ApiItem[] | null> {
  const key = cacheKey(getApi);
  let cached = cache.get(key);
  if (!cached) {
    cached = doLoad(getApi, fetcher, notify);
    cache.set(key, cached);
  }
  return cached;
}

/** 实际加载：fetcher 拉取 → detect 探测 → 分发解析；失败通知（全局去重） */
async function doLoad(
  getApi: any,
  fetcher: ApiFetcher,
  notify?: (key: string) => void
): Promise<ApiItem[] | null> {
  let result: ApiItem[] | null = null;
  try {
    const res = await fetcher(getApi);
    result = parseResponse(res);
  } catch (e) {
    result = null;
  }

  if (!result && !failureNotified) {
    failureNotified = true;
    notify?.(API_LOAD_FAILED_KEY);
  }
  return result;
}

/** 按探测格式分发解析；未知结构返回 null */
function parseResponse(res: any): ApiItem[] | null {
  const detected = detectApiSource(res);
  if (!detected) {
    return null;
  }
  switch (detected.kind) {
    case 'openapi3':
      return parseOpenApi3(detected.body);
    case 'swagger2':
      return parseSwagger2(detected.body);
    case 'simple':
      return parseSimpleList(detected.body);
  }
}
```

- [ ] **Step 4: 运行确认通过**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/__tests__/loader.test.ts`
Expected: PASS（8 个用例）

- [ ] **Step 5: 提交**

```bash
git add packages/amis-editor/src/renderer/apiPicker/
git commit -m "feat(amis-editor): 接口列表加载器（模块级缓存/负缓存/toast去重）"
```

---

### Task 7: apiPicker 模块全量回归

**Files:** 无新增（验证任务）

- [ ] **Step 1: 全模块测试**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/`
Expected: 全部 PASS（35 个用例：detect 6 + openapi 7 + simple 2 + builder 9 + matcher 3 + loader 8）

- [ ] **Step 2: 类型检查**

Run: `npm run typecheck`
Expected: 无新增错误（基线：分支起点 typecheck 已通过）

---
