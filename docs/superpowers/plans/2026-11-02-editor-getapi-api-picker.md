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
    expect(notify).toHaveBeenCalledWith('接口列表获取失败');
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

/** 失败提示原始文案（UI 层用 __() 翻译后 toast；文案由 npm run i18n:update 自动提取进 locale 哈希表） */
export const API_LOAD_FAILED_MSG = '接口列表获取失败';

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
 *   notify - 失败提示回调（入参为原始中文文案，UI 层翻译后 toast，全局去重一次）
 * Returns: 接口列表；失败/非法响应返回 null（调用方降级为普通手输）
 */
export function loadApiItems(
  getApi: any,
  fetcher: ApiFetcher,
  notify?: (msg: string) => void
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
  notify?: (msg: string) => void
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
    notify?.(API_LOAD_FAILED_MSG);
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

## Chunk 2: 类型声明 / 联想 UI / i18n / 文档 / 回归（Task 8-12）

### Task 8: EditorProps.getApi 类型声明

**Files:**
- Modify: `packages/amis-editor-core/src/component/Editor.tsx:24`（import type 行）
- Modify: `packages/amis-editor-core/src/component/Editor.tsx:31-163`（EditorProps 接口）

> 纯类型声明任务，无运行时代码、无单测：`EditorManagerConfig = Omit<EditorProps, 'value'|'onChange'>`（manager.ts:88）使新字段自动进入 config；Editor 构造函数 `...rest` 展开（Editor.tsx:194）自动随 `MainStore.create(_, config)` 下发；读取端 `getEnv(window.editorStore).getApi` 即可取到（与 APIControl.tsx:265 读 schemaFilter 同一机制）。端到端正确性由 Task 12 手测覆盖。

- [ ] **Step 1: 修改 import type 行**

```ts
// Editor.tsx:24 原：
import type {SchemaObject} from 'amis';
// 改为：
import type {SchemaApi, SchemaObject} from 'amis';
```

- [ ] **Step 2: EditorProps 接口新增字段（插在 `amisEnv?: RenderOptions;` 之后）**

```ts
  amisEnv?: RenderOptions;

  /**
   * 全局接口选择配置：指向 OpenAPI(3.0/Swagger 2.0) 文档或简单 items 列表的 GET 接口。
   * 配置后编辑器内 API 配置控件（通用 API/Service 等）支持联想下拉选择接口
   * 并自动回填真实 API 对象与入参模板；未配置则保持手动输入，行为零变化。
   */
  getApi?: SchemaApi;
```

- [ ] **Step 3: 类型检查**

Run: `npm run typecheck`
Expected: 无新增错误

- [ ] **Step 4: 提交**

```bash
git add packages/amis-editor-core/src/component/Editor.tsx
git commit -m "feat(amis-editor-core): EditorProps 新增 getApi 全局接口选择配置"
```

---

### Task 9: APIControl 联想下拉 UI

**Files:**
- Modify: `packages/amis-editor/src/renderer/APIControl.tsx`
- Modify: `packages/amis-editor-core/scss/control/_api-control.scss`

> 本任务不写 UI 自动化测试，理由：amis-editor 包内零 UI 测试基建（无 jest 配置/无 enzyme 或 testing-library 先例），且根 jest moduleNameMapper 未映射 amis-editor-core，搭建成本大于收益。核心逻辑（匹配/生成/缓存/探测）已在 Chunk 1 纯函数全覆盖；交互正确性由 typecheck + Task 12 手测清单验证。

- [ ] **Step 1: 改 import 区（三处）**

```ts
// 1. amis-ui import 加 toast（原：import {Input, PickerContainer, Spinner} from 'amis-ui';）
import {Input, PickerContainer, Spinner, toast} from 'amis-ui';

// 2. 文件尾部 import 区（debounce import 之后）新增：
import {loadApiItems} from './apiPicker/loader';
import {fuzzyMatchApi} from './apiPicker/matcher';
import {buildApiFromItem} from './apiPicker/builder';
import type {ApiItem} from './apiPicker/types';
```

- [ ] **Step 2: class 外新增常量与工具函数（放在 APIControlProps 接口之前）**

```ts
/** 联想下拉最多展示条数 */
const MAX_SUGGESTIONS = 20;

/**
 * 剥离输入框显示值中的 HTTP method 前缀（transformApi2Str 生成 "POST:/api/x" 形态）。
 * 注意：只匹配 HTTP 方法名，避免误剥 "http://" 协议头。
 * Args: value - 输入框当前值
 * Returns: 剥离后的路径/关键词
 */
function stripMethodPrefix(value: string): string {
  return value.replace(/^(get|post|put|patch|delete|head|options):/i, '');
}
```

- [ ] **Step 3: 扩展 APIControlState（替换整个接口）**

```ts
export interface APIControlState {
  apiStr: string;
  selectedItem?: any[];
  schema?: AMISSchemaCollection;
  loading: boolean;
  /** 接口列表（getApi 配置且加载成功）；null = 未启用（未配置/失败），降级普通手输 */
  apiItems: ApiItem[] | null;
  /** 当前关键词匹配项（截断至 MAX_SUGGESTIONS） */
  suggestions: ApiItem[];
  /** 键盘导航激活索引（对应 suggestions 下标），-1 表示无 */
  activeIndex: number;
  /** 联想下拉是否展开 */
  suggestOpened: boolean;
}
```

- [ ] **Step 4: constructor state 初始值补 4 个字段**

```ts
    this.state = {
      apiStr: this.transformApi2Str(props.value),
      selectedItem: [],
      schema: props.pickerSchema,
      loading: false,
      apiItems: null,
      suggestions: [],
      activeIndex: -1,
      suggestOpened: false
    };
```

- [ ] **Step 5: componentDidMount 挂载初始化 + 新增方法**

```ts
  componentDidMount() {
    this.updatePickerOptions();
    this.initApiSuggest();
  }

  /**
   * getApi 全局配置存在时拉取接口列表，启用联想下拉。
   * What: 从 editorStore env 读取 getApi（与读 schemaFilter 同一先例，见 fetchOptions）；
   *   loadApiItems 内部带模块级缓存/负缓存/toast 全局去重；失败返回 null 自动降级。
   * Raises: fetcher 异常由 loadApiItems 捕获，不外抛。
   */
  @autobind
  async initApiSuggest() {
    const {env, translate: __} = this.props;
    const getApi = getEnv((window as any).editorStore)?.getApi;
    if (!getApi || typeof env?.fetcher !== 'function') {
      return;
    }
    const items = await loadApiItems(
      getApi,
      env.fetcher as any,
      msg => toast.error(__(msg))
    );
    if (items) {
      this.setState({apiItems: items});
    }
  }
```

- [ ] **Step 6: 输入/焦点/键盘/选中方法（handleSimpleInputChange 替换 + 新增 4 个方法，放在 clearPickerValue 之后）**

```ts
  handleSimpleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    this.handleSubmit(e.currentTarget.value, 'input');
    this.updateSuggestions(e.currentTarget.value);
  };

  /**
   * 按输入内容更新联想列表（仅启用联想时生效）。
   * Args: input - 输入框原始值（可能带 method 前缀，匹配前剥离）
   */
  @autobind
  updateSuggestions(input: string) {
    const {apiItems} = this.state;
    if (!apiItems) {
      return;
    }
    const suggestions = fuzzyMatchApi(apiItems, stripMethodPrefix(input)).slice(
      0,
      MAX_SUGGESTIONS
    );
    this.setState({suggestions, activeIndex: -1});
  }

  /** 聚焦展开下拉（首次聚焦展示全量前 MAX_SUGGESTIONS 项） */
  @autobind
  handleSuggestFocus() {
    const {apiItems, suggestOpened, apiStr} = this.state;
    if (!apiItems) {
      return;
    }
    if (!suggestOpened) {
      this.updateSuggestions(apiStr);
    }
    this.setState({suggestOpened: true});
  }

  @autobind
  handleSuggestBlur() {
    this.setState({suggestOpened: false});
  }

  /**
   * 联想下拉键盘导航：↓↑ 移动高亮、Enter 选中（仅 activeIndex >= 0 时拦截回车，
   * 不影响手输回车）、Esc 收起。
   */
  @autobind
  handleSuggestKeyDown(e: React.KeyboardEvent) {
    const {suggestions, activeIndex, suggestOpened} = this.state;
    if (!suggestOpened || !suggestions.length) {
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.setState({activeIndex: (activeIndex + 1) % suggestions.length});
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.setState({
        activeIndex: (activeIndex - 1 + suggestions.length) % suggestions.length
      });
    } else if (e.key === 'Enter' && activeIndex >= 0) {
      e.preventDefault();
      this.pickApiItem(suggestions[activeIndex]);
    } else if (e.key === 'Escape') {
      this.setState({suggestOpened: false});
    }
  }

  /**
   * 选中接口项：buildApiFromItem 自动生成 api 对象（url 占位/入参模板），
   * 复用 handleSubmit 与现有 value 合并（data/headers 整替换、adaptor 等保留）。
   */
  @autobind
  pickApiItem(item: ApiItem) {
    this.handleSubmit(buildApiFromItem(item) as SchemaApi, 'input');
    this.setState({suggestOpened: false, activeIndex: -1});
  }
```

- [ ] **Step 7: 联想下拉渲染方法（新增，放在 renderApiDialog 之前）**

```tsx
  /**
   * 联想下拉层：按 tags[0] 分组（无 tags 平铺不显示组标题），保持 fuzzyMatch 排序；
   * 每项 = method 徽标 + 名称 + 路径。
   */
  @autobind
  renderApiSuggest() {
    const {suggestions, suggestOpened, activeIndex, apiItems} = this.state;
    if (!apiItems || !suggestOpened || !suggestions.length) {
      return null;
    }

    const groups: Array<{tag: string; items: ApiItem[]}> = [];
    suggestions.forEach(item => {
      const tag = item.tags?.[0] || '';
      let group = groups.find(g => g.tag === tag);
      if (!group) {
        group = {tag, items: []};
        groups.push(group);
      }
      group.items.push(item);
    });

    return (
      <div className="ae-ApiControl-suggest" key="api-suggest">
        {groups.map(group => (
          <div className="ae-ApiControl-suggest-group" key={group.tag || 'default'}>
            {group.tag ? (
              <div className="ae-ApiControl-suggest-groupTitle">{group.tag}</div>
            ) : null}
            {group.items.map((item, idx) => (
              <div
                key={`${item.method}-${item.path}-${idx}`}
                className={cx('ae-ApiControl-suggest-item', {
                  'is-active': suggestions.indexOf(item) === activeIndex
                })}
                /* 阻止 mousedown 抢焦点导致 Input 先 blur 收起下拉 */
                onMouseDown={e => e.preventDefault()}
                onClick={() => this.pickApiItem(item)}
              >
                <span
                  className={cx(
                    'ae-ApiControl-suggest-method',
                    `is-${item.method}`
                  )}
                >
                  {item.method.toUpperCase()}
                </span>
                <span className="ae-ApiControl-suggest-name" title={item.name}>
                  {item.name}
                </span>
                <span className="ae-ApiControl-suggest-path" title={item.path}>
                  {item.path}
                </span>
              </div>
            ))}
          </div>
        ))}
      </div>
    );
  }
```

- [ ] **Step 8: render() 中 Input 挂事件 + 渲染下拉层（替换现有 `<Input ... />` 块）**

```tsx
                    <Input
                      ref={this.inputRef}
                      value={apiStr}
                      type="text"
                      disabled={disabled}
                      placeholder="http://"
                      onChange={this.handleSimpleInputChange}
                      onFocus={this.handleSuggestFocus}
                      onBlur={this.handleSuggestBlur}
                      onKeyDown={this.handleSuggestKeyDown}
                    />
                    {this.renderApiSuggest()}
```

> 说明：amis-ui 的 `Input` 是原生 input 的受控包装，透传 onFocus/onBlur/onKeyDown；amis-editor 现有爱速搭 Picker（enablePickerMode/highlight）分支不渲染此 Input，两机制天然互斥（spec 第 4 节的优先级声明），无需额外开关判断。

- [ ] **Step 9: scss 追加（_api-control.scss）**

`.ae-ApiControl-input` 规则块内（现有 `& > input` 之前）加定位上下文：

```scss
      .ae-ApiControl-input {
        position: relative; /* 联想下拉定位上下文 */
        // ...现有属性保持不变
```

`.ae-ApiControl` 嵌套内（`&-highlight` 块之后）追加：

```scss
  &-suggest {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    right: 0;
    z-index: 30;
    max-height: 280px;
    overflow-y: auto;
    background: var(--background, #fff);
    border: 1px solid var(--borderColor);
    border-radius: var(--borderRadius);
    box-shadow: var(--boxShadow, 0 4px 12px rgba(0, 0, 0, 0.15));

    &-group {
      &:not(:first-child) {
        border-top: 1px solid var(--borderColor);
      }
    }

    &-groupTitle {
      padding: 4px 8px;
      font-size: 12px;
      color: var(--text--muted-color, #84868c);
      background: var(--colors-neutral-2, #f7f7f9);
    }

    &-item {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 5px 8px;
      cursor: pointer;
      font-size: 12px;

      &:hover,
      &.is-active {
        background: rgba(0, 0, 0, 0.05);
      }
    }

    &-method {
      flex: none;
      padding: 0 4px;
      border-radius: 3px;
      font-size: 11px;
      line-height: 18px;
      color: #fff;
      background: var(--info, #108cee);

      &.is-get {
        background: var(--success, #5fb333);
      }

      &.is-post {
        background: var(--info, #108cee);
      }

      &.is-put {
        background: var(--warning, #f39000);
      }

      &.is-delete {
        background: var(--danger, #d0021b);
      }

      &.is-patch {
        background: var(--info, #108cee);
      }
    }

    &-name {
      flex: none;
      max-width: 45%;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      color: var(--text-color);
    }

    &-path {
      flex: 1;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      text-align: right;
      color: var(--text--muted-color, #84868c);
    }
  }
```

- [ ] **Step 10: 类型与样式检查**

Run: `npm run typecheck`
Expected: 无新增错误

Run: `npm run stylelint`
Expected: 无新增错误

- [ ] **Step 11: 提交**

```bash
git add packages/amis-editor/src/renderer/APIControl.tsx packages/amis-editor-core/scss/control/_api-control.scss
git commit -m "feat(amis-editor): API 配置控件支持 getApi 联想下拉选择"
```

---

### Task 10: i18n 文案提取

**Files:**
- Modify: `packages/amis-editor/src/locale/zh-CN.ts`、`en-US.ts`（由脚本生成）

- [ ] **Step 1: 运行 i18n 提取（Task 9 的 `toast.error(__(msg))` 已包裹文案）**

Run: `npm run i18n:update`
Expected: 命令成功退出；`git diff packages/amis-editor/src/locale/` 可见 zh-CN.ts 新增 `'接口列表获取失败'` 对应的 md5 哈希行

- [ ] **Step 2: 补英文翻译**

在 `packages/amis-editor/src/locale/en-US.ts` 中找到新增的哈希行（与 zh-CN.ts 同 key），值改为：

```ts
  '<新哈希>': 'Failed to load API list',
```

- [ ] **Step 3: 提交**

```bash
git add packages/amis-editor/src/locale/
git commit -m "feat(amis-editor): 接口列表加载失败提示 i18n 文案"
```

---

### Task 11: 使用文档

**Files:**
- Modify: `docs/zh-CN/extend/editor.md`（文末追加章节）

- [ ] **Step 1: 追加章节**

```markdown
## 接口选择（getApi）

宿主可以在编辑器上配置 `getApi`，让所有 API 配置项（接口地址输入框）支持从接口列表中联想选择，并自动回填请求方式、地址与入参模板：

\`\`\`jsx
import {Editor} from 'amis-editor';

<Editor
  getApi="/v3/api-docs" // 指向 OpenAPI 文档或简单接口列表的 GET 请求
  // ...其他配置
/>
\`\`\`

### 数据格式

自动探测返回内容，支持三种格式：

1. **OpenAPI 3.0**（推荐）：响应体含 `openapi` 字段，如 springdoc 暴露的 `/v3/api-docs`。`servers[0].url` 会作为 url 前缀拼接（自动去重斜杠）；`summary`/`operationId` 作为接口名；`tags` 用于下拉分组；path 参数替换为 `\${参数名}` 占位，query 与 requestBody 参数自动生成 `data` 映射模板（如 `{"pageNum": "\${pageNum}"}`），嵌套对象保留结构。
2. **Swagger 2.0**：响应体含 `swagger` 字段，`basePath` 作为前缀，`definitions` 中的请求体定义同样解析。
3. **简单列表**：响应体含 `items` 数组，每项 `{name, method, url, ...}`，`name/method/url` 之外的键（如 `data`、`headers`）在选中时原样透传。

接口列表在编辑器会话内只请求一次并缓存；拉取失败会提示一次并自动降级为手动输入，不影响原有配置方式。未配置 `getApi` 时编辑器行为与之前完全一致。
```

- [ ] **Step 2: 提交**

```bash
git add docs/zh-CN/extend/editor.md
git commit -m "docs: 编辑器 getApi 接口选择配置说明"
```

---

### Task 12: 回归验证与手测

**Files:** 无新增（验证任务；手测对 `packages/amis-editor/examples/Editor.tsx` 的临时改动**不提交**）

- [ ] **Step 1: apiPicker 全量测试**

Run: `./node_modules/.bin/jest packages/amis-editor/src/renderer/apiPicker/`
Expected: 35 个用例全 PASS

- [ ] **Step 2: 全局检查**

Run: `npm run typecheck`
Expected: 无新增错误

Run: `npm run stylelint`
Expected: 无新增错误

- [ ] **Step 3: 手测准备（临时改动 examples/Editor.tsx，勿提交）**

文件顶部（schema 定义之前）加 mock 数据：

```tsx
/** 临时手测 getApi 联想（验证后还原） */
const mockOpenApi = {
  openapi: '3.0.1',
  servers: [{url: '/api'}],
  paths: {
    '/user/list': {
      get: {
        summary: '获取用户列表',
        tags: ['用户管理'],
        parameters: [
          {name: 'pageNum', in: 'query', required: true, schema: {type: 'integer'}}
        ]
      }
    },
    '/user/{id}': {
      get: {
        summary: '用户详情',
        tags: ['用户管理'],
        parameters: [
          {name: 'id', in: 'path', required: true, schema: {type: 'string'}}
        ]
      }
    },
    '/user/create': {
      post: {
        summary: '创建用户',
        tags: ['用户管理'],
        requestBody: {
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name'],
                properties: {
                  name: {type: 'string'},
                  role: {type: 'string', enum: ['admin', 'user']}
                }
              }
            }
          }
        }
      }
    }
  }
};
```

`<Editor ... />` props 加 `getApi` 与 fetcher 拦截（合并进现有 amisEnv 对象）：

```tsx
        getApi="/api-docs.json"
        amisEnv={
          {
            fetcher: async (api: any) => {
              if (api?.url === '/api-docs.json') {
                return {data: mockOpenApi}; // 裸文档在 res.data（axios 风格），验证外层探测
              }
              return Promise.resolve({data: {status: 0, data: {}}});
            },
            variable: {/* 保持原样 */},
            replaceText
          } as any
        }
```

- [ ] **Step 4: 启动并逐项手测**

Run: `npm start`，浏览器访问 `http://127.0.0.1:8888/packages/amis-editor/`

| # | 手测项 | 预期 |
|---|---|---|
| 1 | 基线：先注释掉 getApi prop，拖入 Service 组件看 API 输入框 | 与现状完全一致（无下拉、无请求） |
| 2 | 恢复 getApi，拖入 Service，点击 API 输入框 | 出现下拉，"用户管理"分组标题，3 项带 method 徽标 |
| 3 | 输入 `用户` / `list` / `USER` | 分别按名称/路径/大小写不敏感过滤，前缀命中排前 |
| 4 | 键盘 ↓ ↑ Enter Esc | 高亮循环移动；Enter 选中；Esc 收起；未高亮时 Enter 不拦截 |
| 5 | 点击"用户详情"（get） | 输入框显示 `/api/user/${id}`；高级设置中 url 为 `/api/user/${id}` |
| 6 | 点击"创建用户"（post） | 输入框显示 `POST:/api/user/create`；高级设置"发送数据"含 `{name: '${name}', role: '${role}'}` |
| 7 | 手输 `/my/custom/api` 并失焦 | 正常生成配置，无强制选择/无报错 |
| 8 | mock fetcher 改为 `throw new Error('x')` 重启 | toast 一次"接口列表获取失败"，输入框仍可正常手输；切换多个组件面板不重复 toast、Network 只有一次请求 |

- [ ] **Step 5: 还原手测临时改动**

Run: `git checkout -- packages/amis-editor/examples/Editor.tsx`
Expected: `git status` 干净（除已提交内容）

- [ ] **Step 6: 最终确认提交（如有手测中的样式/交互微调）**

```bash
git status
# 如有微调：
git add -A && git commit -m "fix(amis-editor): getApi 联想手测微调"
```

---

## 完成定义

- [ ] apiPicker 35 个单测全绿；typecheck/stylelint 无新增错误
- [ ] 未配置 getApi：编辑器行为与现状零差异（手测项 1/7）
- [ ] 配置 getApi：联想选择、入参自动化回填、失败降级全部符合 spec（手测项 2-8）
- [ ] 文档（editor.md）与 i18n（zh-CN/en-US）齐备
