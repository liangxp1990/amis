import React from 'react';
import mergeWith from 'lodash/mergeWith';
import cloneDeep from 'lodash/cloneDeep';
import cx from 'classnames';
import {FormItem, Icon} from 'amis';
import {Input, PickerContainer, Spinner, toast} from 'amis-ui';

import {getEnv} from 'mobx-state-tree';
import {normalizeApi, isEffectiveApi, isApiOutdated} from 'amis-core';

import {
  isObject,
  autobind,
  createObject,
  tipedLabel,
  anyChanged,
  getSchemaTpl
} from 'amis-editor-core';

import type {SchemaObject, SchemaApi} from 'amis';
import type {Api, AMISButtonSchema} from 'amis';
import type {AMISSchemaCollection, FormControlProps} from 'amis-core';
import type {ActionSchema} from 'amis';
import debounce from 'lodash/debounce';
import {i18n as _i18n} from 'i18n-runtime';
import {loadApiItems} from './apiPicker/loader';
import {fuzzyMatchApi} from './apiPicker/matcher';
import {buildApiFromItem} from './apiPicker/builder';
import type {ApiItem} from './apiPicker/types';

export type ApiObject = Api & {
  messages?: Record<
    | 'fetchSuccess'
    | 'fetchFailed'
    | 'saveOrderSuccess'
    | 'saveOrderFailed'
    | 'quickSaveSuccess'
    | 'quickSaveFailed',
    string
  >;
};

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

export interface APIControlProps extends FormControlProps {
  name?: string;
  label?: string;
  value?: any;

  /**
   * 开启debug模式
   */
  debug?: boolean;

  /**
   * 接口消息设置描述信息
   */
  messageDesc?: string;

  /**
   * 顶部按钮集合
   */
  actions?: Array<AMISButtonSchema>;

  /**
   * 底部集合
   */
  footer?: Array<SchemaObject>;

  /**
   * 是否开启选择模式，开启后actions属性失效
   */
  enablePickerMode?: boolean;

  /**
   * 触发Picker的按钮配置
   */
  pickerBtnSchema?: AMISButtonSchema;

  /**
   * picker标题
   */
  pickerTitle?: string;

  /**
   * Picker绑定的Name
   */
  pickerName?: string;

  /**
   * picker模式的Schema
   */
  pickerSchema?: AMISSchemaCollection;

  /**
   * Picker数据源
   */
  pickerSource?: SchemaApi;

  /**
   * Picker弹窗大小
   */
  pickerSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

  /**
   * Picker顶部的CSS类名
   */
  pickerHeaderClassName?: string;

  /**
   * 是否只返回内部TabsPanel
   */
  onlyTabs?: boolean;

  /**
   * 开启高亮显示
   */
  enableHighlight?: boolean;

  /**
   * Picker选项的label字段
   */
  labelField?: string;

  /**
   * 检索字段
   */
  searchField?: string;

  /**
   * 检索字段类型
   */
  searchType?: string;

  /**
   * 底部区域CSS类名
   */
  footerClassName?: string;

  /**
   * Picker面板确认
   */
  onPickerConfirm: (values: any) => void | any;

  /**
   * Picker面板关闭
   */
  onPickerClose: () => void;

  /**
   * Picker面板选择
   */
  onPickerSelect: (values: any) => void | any;

  onAction: (
    schema: ActionSchema,
    e: React.MouseEvent<any> | void | null,
    action: object,
    data: any
  ) => void;
}

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

export default class APIControl extends React.Component<
  APIControlProps,
  APIControlState
> {
  input?: HTMLInputElement;

  static defaultProps: Pick<
    APIControlProps,
    'pickerBtnSchema' | 'labelField' | 'searchType'
  > = {
    pickerBtnSchema: {
      type: 'button',
      level: 'link',
      size: 'sm'
    },
    labelField: 'label',
    searchType: 'key'
  };

  constructor(props: APIControlProps) {
    super(props);

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
  }

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
    const {env, enablePickerMode, enableHighlight} = this.props;
    // 爱速搭 Picker / highlight 模式优先，getApi 联想不启用（spec 第 4 节互斥约定）
    if (enablePickerMode || enableHighlight) {
      return;
    }
    const getApi = getEnv((window as any).editorStore)?.getApi;
    if (!getApi || typeof env?.fetcher !== 'function') {
      return;
    }
    // 文案字面量必须内联在 _i18n() 调用里，构建期 i18n 插件才会做哈希替换（见 event-control 先例）
    const items = await loadApiItems(getApi, env.fetcher as any, () =>
      toast.error(_i18n('接口列表获取失败'))
    );
    if (items) {
      this.setState({apiItems: items});
    }
  }

  componentDidUpdate(prevProps: APIControlProps) {
    const props = this.props;
    if (prevProps.value !== props.value) {
      this.setState({apiStr: this.transformApi2Str(props.value)});
      this.updatePickerOptions();
    }
    if (anyChanged(['enablePickerMode', 'pickerSchema'], prevProps, props)) {
      this.setState({schema: props.pickerSchema});
    }

    if (
      isApiOutdated(
        prevProps?.pickerSource,
        props?.pickerSource,
        prevProps.data,
        props.data
      )
    ) {
      this.fetchOptions();
    }
  }

  /**
   * 已选API详情，因为list接口是分页的，所以需要单独调用一次
   */
  async updatePickerOptions() {
    const apiObj = normalizeApi(this.props.value);

    if (apiObj?.url?.startsWith('api://')) {
      this.setState({loading: true});
      const keyword = apiObj.url.replace('api://', '');

      try {
        await this.fetchOptions(keyword);
      } catch (error) {}
    }
    this.setState({loading: false});
  }

  transformApi2Str(value: any) {
    const api = normalizeApi(value);

    return api.url
      ? `${
          api.method &&
          api.method.toLowerCase() !==
            'get' /** 默认为GET请求，直接隐藏掉前缀，为了呈现更多信息 */
            ? `${api.method}:`
            : ''
        }${api.url}`
      : '';
  }

  async fetchOptions(keyword?: string) {
    const {value, data, env, searchField, searchType} = this.props;
    let {pickerSource} = this.props;
    const apiObj = normalizeApi(value);

    if (!pickerSource || !apiObj?.url) {
      return;
    }

    const apiKey = apiObj?.url?.split('api://')?.[1];
    const ctx = createObject(data, {
      value,
      op: 'loadOptions',
      ...(keyword && searchField ? {[searchField]: keyword, searchType} : {})
    });
    const schemaFilter = getEnv((window as any).editorStore).schemaFilter;

    // 基于爱速搭的规则转换一下
    if (schemaFilter) {
      pickerSource = schemaFilter({api: pickerSource}).api;
    }

    if (isEffectiveApi(pickerSource, ctx)) {
      const res = await env.fetcher(pickerSource, ctx);
      const items: any[] = res.data?.items || res?.data?.rows;

      if (items.length) {
        const selectedItem = items.find(item => item.key === apiKey);

        this.setState({selectedItem: selectedItem ? [selectedItem] : []});
      }
    }
  }

  @autobind
  inputRef(ref: any) {
    this.input = ref;
  }

  focus() {
    if (!this.input) {
      return;
    }

    this.input.focus();
  }

  @autobind
  clearPickerValue() {
    const {onChange} = this.props;

    this.setState(
      {apiStr: this.transformApi2Str(undefined), selectedItem: []},
      () => {
        onChange?.(undefined);
        this.focus();
      }
    );
  }

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
    // 有匹配时同步展开下拉：覆盖 Esc 收起后继续输入需重开的场景；无匹配保持现状
    this.setState({
      suggestions,
      activeIndex: -1,
      suggestOpened: suggestions.length > 0 || this.state.suggestOpened
    });
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
    // 未展开时早退，避免未启用联想的普通失焦触发冗余 setState
    if (!this.state.suggestOpened) {
      return;
    }
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
   * 复用 handleSubmit 与现有 value 合并（沿用其 mergeWith 语义：仅当选中项
   * 携带 data/headers 等字段时才整替换对应键，无参数项不会覆盖旧值，adaptor 等保留）。
   */
  @autobind
  pickApiItem(item: ApiItem) {
    this.handleSubmit(buildApiFromItem(item) as SchemaApi, 'input');
    this.setState({suggestOpened: false, activeIndex: -1});
  }

  @autobind
  handleSubmit(values: SchemaApi, action?: 'input' | 'picker-submit') {
    const {onChange, value} = this.props;
    let api: Api = values;

    // Picker未做选择
    if (!values && action === 'picker-submit') {
      return;
    }

    if (typeof value !== 'string' || typeof values !== 'string') {
      api = mergeWith(
        {},
        normalizeApi(value),
        normalizeApi(values),
        (value, srcValue, key) => {
          // 这三个支持删除单个key的属性需用新值完全替换
          // 否则删除无效
          if (['data', 'responseData', 'headers'].includes(key)) {
            return srcValue;
          }
        }
      );
      ['data', 'responseData', 'headers'].forEach((item: keyof Api) => {
        if (api[item] == null) {
          delete api[item];
        }
      });
    }
    onChange?.(api);
  }

  handleAction(
    schema: ActionSchema,
    e: React.MouseEvent<any> | void | null,
    action: object,
    data: any
  ) {
    const {onAction} = this.props;

    onAction?.(schema, e, action, data);
  }

  normalizeValue(value: any, callback: (value: any) => any) {
    let transformedValue = cloneDeep(value);

    if (typeof callback === 'function') {
      transformedValue = callback(value);
    }

    return transformedValue;
  }

  @autobind
  handlePickerConfirm(value: any) {
    const {onPickerConfirm} = this.props;

    this.handleSubmit(
      this.normalizeValue(value, onPickerConfirm),
      'picker-submit'
    );
  }

  @autobind
  handlePickerClose() {
    const {onPickerClose} = this.props;

    onPickerClose?.();
  }

  @autobind
  renderHeader() {
    const {render, labelRemark, useMobileUI, popOverContainer, env} =
      this.props;
    const label: any = this.props.label;
    const classPrefix = env?.theme?.classPrefix;

    // const actionsDom =
    //   Array.isArray(actions) && actions.length > 0
    //     ? actions.map((action, index) => {
    //         return render(`action/${index}`, action, {
    //           key: index,
    //           onAction: this.handleAction.bind(this, action)
    //         });
    //       })
    //     : null;

    return (
      <header className="ApiControl-header" key="header">
        <label className={cx(`${classPrefix}Form-label`)}>
          {label?.type ? render('label', label) : label || ''}
          {labelRemark
            ? render(
                'label-remark',
                {
                  type: 'remark',
                  icon: labelRemark.icon || 'warning-mark',
                  tooltip: labelRemark,
                  className: cx(`Form-lableRemark`, labelRemark?.className),
                  useMobileUI
                },
                {
                  container: popOverContainer || env.getModalContainer
                }
              )
            : null}
        </label>
      </header>
    );
  }

  renderPickerSchema() {
    const {
      render,
      pickerTitle,
      pickerName = 'apiPicker',
      pickerSize,
      pickerHeaderClassName,
      pickerBtnSchema,
      enablePickerMode,
      onPickerSelect
    } = this.props;
    const {selectedItem, schema} = this.state;

    if (!schema) {
      return null;
    }

    return (
      <PickerContainer
        title={pickerTitle}
        headerClassName={cx(pickerHeaderClassName, 'font-bold')}
        onConfirm={this.handlePickerConfirm}
        onCancel={this.handlePickerClose}
        size={pickerSize}
        bodyRender={({
          onChange,
          setState
        }: {
          onChange: (value: any) => void;
          setState: (state: any) => void;
        }) => {
          return render('api-control-picker', schema!, {
            value: selectedItem,
            onSelect: (items: Array<any>) => {
              setState({selectedItem: items});
              onChange(this.normalizeValue(items, onPickerSelect));
            }
          });
        }}
      >
        {({
          onClick,
          isOpened
        }: {
          onClick: (e: React.MouseEvent) => void;
          isOpened: boolean;
        }) =>
          render(
            'picker-action',
            {
              icon: (
                <Icon icon="picker-icon" className="icon ae-ApiControl-icon" />
              ),
              ...pickerBtnSchema!,
              className: cx(
                'ae-ApiControl-PickerBtn',
                pickerBtnSchema?.className
              )
            } as any,
            {
              onClick: async (e: React.MouseEvent<any>) => {
                if (!isOpened && enablePickerMode) {
                  try {
                    await this.fetchOptions();
                  } catch {}
                }

                onClick(e);
              }
            }
          )
        }
      </PickerContainer>
    );
  }

  /**
   * 联想下拉层：按 tags[0] 分组（无 tags 平铺不显示组标题），保持 fuzzyMatch 排序；
   * 每项 = method 徽标 + 名称 + 路径。
   */
  @autobind
  renderApiSuggest() {
    const {enablePickerMode, enableHighlight} = this.props;
    const {suggestions, suggestOpened, activeIndex, apiItems} = this.state;
    // 爱速搭 Picker / highlight 模式优先，不渲染联想下拉（与 initApiSuggest 双重保险）
    if (enablePickerMode || enableHighlight) {
      return null;
    }
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
      <div
        className="ae-ApiControl-suggest"
        key="api-suggest"
        /* 容器级拦截 mousedown 抢焦点：覆盖下拉滚动条/轨道/分组标题/所有条目，
           避免拖动滚动时 Input 先 blur 收起下拉 */
        onMouseDown={e => e.preventDefault()}
      >
        {groups.map(group => (
          <div
            className="ae-ApiControl-suggest-group"
            key={group.tag || 'default'}
          >
            {group.tag ? (
              <div className="ae-ApiControl-suggest-groupTitle">
                {group.tag}
              </div>
            ) : null}
            {group.items.map((item, idx) => (
              <div
                key={`${item.method}-${item.path}-${idx}`}
                className={cx('ae-ApiControl-suggest-item', {
                  'is-active': suggestions.indexOf(item) === activeIndex
                })}
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

  renderApiDialog() {
    return {
      label: '',
      type: 'action',
      acitonType: 'dialog',
      size: 'sm',
      icon: <Icon icon="setting" className="icon ae-ApiControl-icon" />,
      className: 'ae-ApiControl-setting-button',
      actionType: 'dialog',
      dialog: {
        title: '高级设置',
        size: 'md',
        className: 'ae-ApiControl-dialog',
        headerClassName: 'font-bold',
        bodyClassName: 'ae-ApiControl-dialog-body',
        closeOnEsc: true,
        closeOnOutside: false,
        showCloseButton: true,
        // data: {},
        body: [this.renderApiConfigTabs()]
      }
    };
  }

  renderApiConfigTabs(submitOnChange: boolean = false) {
    const {messageDesc, debug = false, name} = this.props;

    return {
      type: 'form',
      className: 'ae-ApiControl-form :AMISCSSWrapper',
      mode: 'horizontal',
      submitOnChange,
      wrapWithPanel: false,
      onSubmit: this.handleSubmit,
      debug,
      body: [
        {
          type: 'tabs',
          className: 'ae-ApiControl-tabs',
          contentClassName: 'ae-ApiControl-tabContent',
          tabs: [
            {
              title: '接口设置',
              tab: [
                {
                  label: '发送方式',
                  name: 'method',
                  value: 'get',
                  type: 'button-group-select',
                  mode: 'horizontal',
                  options: [
                    {
                      value: 'get',
                      label: 'GET'
                    },
                    {
                      value: 'post',
                      label: 'POST'
                    },
                    {
                      value: 'put',
                      label: 'PUT'
                    },
                    {
                      value: 'patch',
                      label: 'PATCH'
                    },
                    {
                      value: 'delete',
                      label: 'DELETE'
                    }
                  ]
                },
                {
                  label: '接口地址',
                  type: 'input-text',
                  name: 'url',
                  mode: 'horizontal',
                  size: 'lg',
                  placeholder: 'http://',
                  required: true
                },
                {
                  label: '发送条件',
                  type: 'input-text',
                  name: 'sendOn',
                  mode: 'horizontal',
                  size: 'lg',
                  placeholder: '如：this.type == "123"',
                  description: '用表达式来设置该请求的发送条件'
                },
                {
                  label: '数据格式',
                  type: 'button-group-select',
                  name: 'dataType',
                  size: 'sm',
                  mode: 'horizontal',
                  description: `${'发送体格式为'}：<%= data.dataType === "json" ? "application/json" : (data.dataType === "form-data" ? "multipart/form-data" : (data.dataType === "form" ? "application/x-www-form-urlencoded" : "")) %>，${'当发送内容中存在文件时会自动使用 form-data 格式。'}`,
                  options: [
                    {
                      label: 'JSON',
                      value: 'json'
                    },
                    {
                      label: 'FormData',
                      value: 'form-data'
                    },
                    {
                      label: 'Form',
                      value: 'form'
                    }
                  ],
                  disabled: false
                },
                {
                  type: 'group',
                  body: [
                    {
                      type: 'switch',
                      label: tipedLabel(
                        '静默请求',
                        '是否静默发送请求，屏蔽报错提示'
                      ),
                      name: 'silent',
                      mode: 'horizontal'
                    }
                  ]
                },
                {
                  type: 'switch',
                  label: '是否设置缓存',
                  name: 'cache',
                  mode: 'horizontal',
                  pipeIn: (value: any) => !!value,
                  pipeOut: (value: any) => (value ? 3000 : undefined)
                },
                {
                  label: '',
                  type: 'input-number',
                  name: 'cache',
                  mode: 'horizontal',
                  size: 'md',
                  min: 0,
                  step: 500,
                  visibleOn: 'this.cache',
                  description: '设置该请求缓存有效时间，单位 ms',
                  pipeIn: (value: any) =>
                    typeof value === 'number' ? value : 0
                },
                {
                  label: '文件下载',
                  name: 'responseType',
                  type: 'switch',
                  mode: 'horizontal',
                  description:
                    '当接口为二进制文件下载时请勾选，否则会文件乱码。',
                  pipeIn: (value: any) => value === 'blob',
                  pipeOut: (value: any) => (value ? 'blob' : undefined)
                },
                {
                  label: '数据替换',
                  name: 'replaceData',
                  type: 'switch',
                  mode: 'horizontal',
                  description: '默认数据为追加方式，开启后完全替换当前数据'
                },
                {
                  label: '',
                  name: 'interval',
                  type: 'input-number',
                  mode: 'horizontal',
                  size: 'md',
                  visibleOn: 'typeof this.interval === "number"',
                  step: 500,
                  description: '定时刷新间隔，单位 ms'
                },
                {
                  label: '静默刷新',
                  name: 'silentPolling',
                  type: 'switch',
                  mode: 'horizontal',
                  visibleOn: '!!data.interval',
                  description: '设置自动定时刷新时是否显示loading'
                },
                {
                  label: tipedLabel(
                    '定时刷新停止',
                    '定时刷新一旦设置会一直刷新，除非给出表达式，条件满足后则停止刷新'
                  ),
                  name: 'stopAutoRefreshWhen',
                  type: 'input-text',
                  mode: 'horizontal',
                  horizontal: {
                    leftFixed: 'md'
                  },
                  size: 'lg',
                  visibleOn: '!!data.interval',
                  placeholder: '停止定时刷新检测表达式'
                }
              ]
            },
            {
              title: 'HTTP配置',
              tab: [
                {
                  type: 'switch',
                  label: tipedLabel(
                    '请求头',
                    '可以配置<code>headers</code>对象，添加自定义请求头'
                  ),
                  name: 'headers',
                  mode: 'horizontal',
                  className: 'm-b-xs',
                  pipeIn: (value: any) => !!value,
                  pipeOut: (value: any) => (value ? {'': ''} : null)
                },
                {
                  type: 'combo',
                  name: 'headers',
                  mode: 'horizontal',
                  syncDefaultValue: false,
                  multiple: true,
                  visibleOn: 'this.headers',
                  items: [
                    {
                      type: 'input-text',
                      name: 'key',
                      placeholder: 'Key',
                      unique: true,
                      required: true,
                      options: [
                        {
                          label: 'Content-Encoding',
                          value: 'Content-Encoding'
                        },
                        {
                          label: 'Content-Type',
                          value: 'Content-Type'
                        }
                      ]
                    },
                    {
                      type: 'input-text',
                      name: 'value',
                      placeholder: 'Value',
                      disabled: false
                    }
                  ],
                  pipeIn: (value: any) => {
                    if (!isObject(value)) {
                      return value;
                    }

                    let arr: Array<any> = [];

                    Object.keys(value).forEach(key => {
                      arr.push({
                        key: key || '',
                        value:
                          typeof value[key] === 'string'
                            ? value[key]
                            : JSON.stringify(value[key])
                      });
                    });
                    return arr;
                  },
                  pipeOut: (value: any) => {
                    if (!Array.isArray(value)) {
                      return value;
                    }
                    let obj: any = {};

                    value.forEach((item: any) => {
                      let key: string = item.key || '';
                      let value: any = item.value;
                      try {
                        value = JSON.parse(value);
                      } catch (e) {}

                      obj[key] = value;
                    });
                    return obj;
                  }
                },
                {
                  type: 'switch',
                  label: tipedLabel(
                    '发送数据',
                    '当没开启数据映射时，发送 API 的时候会发送尽可能多的数据，如果你想自己控制发送的数据，或者需要额外的数据处理，请开启此选项'
                  ),
                  name: 'data',
                  mode: 'horizontal',
                  pipeIn: (value: any) => !!value,
                  pipeOut: (value: any) => (value ? {'&': '$$'} : null)
                },
                {
                  type: 'combo',
                  syncDefaultValue: false,
                  name: 'data',
                  mode: 'horizontal',
                  renderLabel: false,
                  visibleOn: 'this.data',
                  descriptionClassName: 'help-block text-xs m-b-none',
                  description:
                    '<p>当没开启数据映射时，发送数据自动切成白名单模式，配置啥发送啥，请绑定数据。如：<code>{"a": "\\${a}", "b": 2}</code></p><p>如果希望在默认的基础上定制，请先添加一个 Key 为 `&` Value 为 `\\$$` 作为第一行。</p><div>当值为 <code>__undefined</code>时，表示删除对应的字段，可以结合<code>{"&": "\\$$"}</code>来达到黑名单效果。</div>',
                  multiple: true,
                  pipeIn: (value: any) => {
                    if (!isObject(value)) {
                      return value;
                    }

                    let arr: Array<any> = [];

                    Object.keys(value).forEach(key => {
                      arr.push({
                        key: key || '',
                        value:
                          typeof value[key] === 'string'
                            ? value[key]
                            : JSON.stringify(value[key])
                      });
                    });
                    return arr;
                  },
                  pipeOut: (value: any) => {
                    if (!Array.isArray(value)) {
                      return value;
                    }
                    let obj: any = {};

                    value.forEach((item: any) => {
                      let key: string = item.key || '';
                      let value: any = item.value;
                      try {
                        value = JSON.parse(value);
                      } catch (e) {}

                      obj[key] = value;
                    });
                    return obj;
                  },
                  items: [
                    {
                      placeholder: 'Key',
                      type: 'input-text',
                      unique: true,
                      name: 'key',
                      required: true
                    },

                    getSchemaTpl('DataPickerControl', {
                      placeholder: 'Value',
                      name: 'value'
                    })
                  ]
                },
                getSchemaTpl('apiRequestAdaptor'),
                {
                  type: 'switch',
                  label: tipedLabel(
                    '返回数据',
                    '如果需要对返回结果中的data做额外的数据处理，请开启此选项'
                  ),
                  name: 'responseData',
                  mode: 'horizontal',
                  pipeIn: (value: any) => !!value,
                  pipeOut: (value: any) => (value ? {'&': '$$'} : null)
                },
                {
                  type: 'combo',
                  syncDefaultValue: false,
                  name: 'responseData',
                  mode: 'horizontal',
                  renderLabel: false,
                  visibleOn: 'this.responseData',
                  descriptionClassName: 'help-block text-xs m-b-none',
                  multiple: true,
                  pipeIn: (value: any) => {
                    if (!isObject(value)) {
                      return value;
                    }

                    let arr: Array<any> = [];

                    Object.keys(value).forEach(key => {
                      arr.push({
                        key: key || '',
                        value:
                          typeof value[key] === 'string'
                            ? value[key]
                            : JSON.stringify(value[key])
                      });
                    });
                    return arr;
                  },
                  pipeOut: (value: any) => {
                    if (!Array.isArray(value)) {
                      return value;
                    }
                    let obj: any = {};

                    value.forEach((item: any) => {
                      let key: string = item.key || '';
                      let value: any = item.value;
                      try {
                        value = JSON.parse(value);
                      } catch (e) {}

                      obj[key] = value;
                    });
                    return obj;
                  },
                  items: [
                    {
                      placeholder: 'Key',
                      type: 'input-text',
                      unique: true,
                      name: 'key',
                      required: true
                    },

                    {
                      placeholder: 'Value',
                      type: 'input-text',
                      name: 'value'
                    }
                  ]
                },
                getSchemaTpl(
                  name === 'validateApi' ? 'validateApiAdaptor' : 'apiAdaptor'
                )
              ]
            },
            {
              title: '提示信息',
              tab: [
                {
                  label: '默认提示文案',
                  type: 'combo',
                  name: 'messages',
                  mode: 'normal',
                  multiLine: true,
                  items: [
                    {
                      label: '请求成功',
                      type: 'input-text',
                      name: 'success'
                    },

                    {
                      label: '请求失败',
                      type: 'input-text',
                      name: 'failed'
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    };
  }

  render() {
    const {
      render,
      className,
      footerClassName,
      classPrefix,
      label,
      labelRemark,
      value,
      footer,
      border = false,
      onlyTabs = false,
      messageDesc,
      enablePickerMode,
      disabled,
      mode,
      enableHighlight,
      labelField = 'label',
      useMobileUI,
      popOverContainer,
      env,
      renderLabel
    } = this.props;
    let {apiStr, selectedItem, loading} = this.state;
    selectedItem =
      Array.isArray(selectedItem) && selectedItem.length !== 0
        ? selectedItem
        : [];
    const highlightLabel = selectedItem?.[0]?.[labelField] ?? '';

    return (
      <>
        <div className={cx('ae-ApiControl', className, {border})}>
          {onlyTabs ? (
            render('api-control-tabs', this.renderApiConfigTabs(true) as any, {
              data: normalizeApi(value)
            })
          ) : (
            <>
              {!renderLabel && this.renderHeader()}

              <div className="ae-ApiControl-content" key="content">
                <div className={cx('ae-ApiControl-input')}>
                  {enableHighlight && highlightLabel ? (
                    <div className={cx('ae-ApiControl-highlight')}>
                      {loading ? (
                        <Spinner
                          show
                          icon="reload"
                          size="sm"
                          spinnerClassName={cx('Select-spinner')}
                        />
                      ) : (
                        <span className={cx('ae-ApiControl-highlight-tag')}>
                          <span>{highlightLabel}</span>
                          <a
                            onClick={this.clearPickerValue}
                            className={cx('Modal-close')}
                          >
                            <Icon
                              icon="close"
                              className={cx(
                                'icon',
                                'ae-ApiControl-highlight-close'
                              )}
                            />
                          </a>
                        </span>
                      )}
                    </div>
                  ) : (
                    <>
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
                    </>
                  )}
                  {enablePickerMode ? this.renderPickerSchema() : null}
                </div>

                {render('api-control-dialog', this.renderApiDialog() as any, {
                  data: normalizeApi(value)
                })}
              </div>
            </>
          )}
        </div>
        {Array.isArray(footer) && footer.length !== 0 ? (
          <footer className={cx('mt-3', footerClassName)} key="footer">
            {render('api-control-footer', footer)}
          </footer>
        ) : null}
      </>
    );
  }
}

@FormItem({
  type: 'ae-apiControl',
  renderLabel: false
})
export class APIControlRenderer extends APIControl {}
