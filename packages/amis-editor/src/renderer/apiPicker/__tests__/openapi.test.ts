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
