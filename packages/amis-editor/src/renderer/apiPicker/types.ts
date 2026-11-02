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
