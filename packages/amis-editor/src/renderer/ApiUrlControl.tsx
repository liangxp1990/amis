/**
 * ae-apiUrlControl：高级设置弹窗内的"接口地址"联想输入控件。
 * What: 当全局 getApi 配置且接口列表加载成功时（由 APIControl 的 tabs 渲染方
 *   决定是否启用本控件），提供与外层输入框一致的联想下拉；接口列表复用
 *   loader 的模块级缓存（同一 getApi 零额外请求）。选中接口后通过 onBulkChange
 *   一次性联动更新 url / method / data（data 仅在选中项携带时整体替换，与外层
 *   选中语义一致）。未启用联想时行为等同普通文本输入。
 */
import React from 'react';
import cx from 'classnames';
import {FormItem} from 'amis';
import {Input, toast} from 'amis-ui';
import {i18n as _i18n} from 'i18n-runtime';
import {getEnv} from 'mobx-state-tree';
import {autobind} from 'amis-editor-core';

import {loadApiItems} from './apiPicker/loader';
import {fuzzyMatchApi} from './apiPicker/matcher';
import {buildApiFromItem} from './apiPicker/builder';
import ApiSuggestList from './apiPicker/ApiSuggestList';
import type {ApiItem} from './apiPicker/types';
import type {FormControlProps} from 'amis-core';

/** 联想下拉最多展示条数（与 APIControl 保持一致） */
const MAX_SUGGESTIONS = 20;

export interface ApiUrlControlProps extends FormControlProps {
  value?: string;
}

export interface ApiUrlControlState {
  /** 接口列表；null = 未启用联想（未配置/失败），等同普通输入框 */
  apiItems: ApiItem[] | null;
  suggestions: ApiItem[];
  activeIndex: number;
  opened: boolean;
}

export class ApiUrlControl extends React.Component<
  ApiUrlControlProps,
  ApiUrlControlState
> {
  static defaultProps: Pick<ApiUrlControlProps, 'placeholder'> = {
    placeholder: 'http://'
  };

  constructor(props: ApiUrlControlProps) {
    super(props);
    this.state = {
      apiItems: null,
      suggestions: [],
      activeIndex: -1,
      opened: false
    };
  }

  componentDidMount() {
    this.initApiSuggest();
  }

  /**
   * 从全局配置与模块级缓存初始化接口列表。
   * Why: 高级设置弹窗每次打开都会重新挂载本控件，走 loadApiItems 的缓存
   *   （同一 getApi 配置）不会重复请求。editorStore 缺失场景（脱离编辑器
   *   上下文渲染）直接跳过，避免 MST getEnv 对非树节点抛错。
   */
  @autobind
  async initApiSuggest() {
    const {env} = this.props;
    const store = (window as any).editorStore;
    const getApi = store ? getEnv(store)?.getApi : undefined;
    if (!getApi || typeof env?.fetcher !== 'function') {
      return;
    }
    const items = await loadApiItems(getApi, env.fetcher as any, () =>
      toast.error(_i18n('接口列表获取失败'))
    );
    if (items) {
      this.setState({apiItems: items});
    }
  }

  @autobind
  handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const {onChange} = this.props;
    onChange?.(e.currentTarget.value);
    this.updateSuggestions(e.currentTarget.value);
  }

  /** 按输入内容更新联想列表；有匹配时自动展开（Esc 后继续输入可重开） */
  @autobind
  updateSuggestions(input: string) {
    const {apiItems} = this.state;
    if (!apiItems) {
      return;
    }
    const suggestions = fuzzyMatchApi(apiItems, input || '').slice(
      0,
      MAX_SUGGESTIONS
    );
    this.setState(prev => ({
      suggestions,
      activeIndex: -1,
      opened: suggestions.length > 0 || prev.opened
    }));
  }

  @autobind
  handleFocus() {
    const {apiItems, opened} = this.state;
    const {value} = this.props;
    if (!apiItems) {
      return;
    }
    if (!opened) {
      this.updateSuggestions(value || '');
    }
    this.setState({opened: true});
  }

  @autobind
  handleBlur() {
    if (!this.state.opened) {
      return;
    }
    this.setState({opened: false});
  }

  /** 键盘导航：↓↑ 移动、Enter 选中（仅激活时拦截）、Esc 收起 */
  @autobind
  handleKeyDown(e: React.KeyboardEvent) {
    const {suggestions, activeIndex, opened} = this.state;
    if (!opened || !suggestions.length) {
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
      this.setState({opened: false});
    }
  }

  /**
   * 选中接口：入参自动化生成 api 对象，onBulkChange 一次性联动
   * url/method/data（data 仅在选中项携带时更新，无参数项保留旧值）。
   */
  @autobind
  pickApiItem(item: ApiItem) {
    const {onChange, onBulkChange} = this.props;
    const api: any = buildApiFromItem(item);
    const patch: any = {url: api.url, method: api.method};
    if (api.data !== undefined) {
      patch.data = api.data;
    }
    if (onBulkChange) {
      onBulkChange(patch);
    } else {
      onChange?.(api.url);
    }
    this.setState({opened: false, activeIndex: -1});
  }

  render() {
    const {value, disabled, placeholder, className} = this.props;
    const {apiItems, suggestions, activeIndex, opened} = this.state;

    return (
      <div className={cx('ae-ApiUrlControl', className)}>
        <Input
          value={value ?? ''}
          type="text"
          disabled={disabled}
          placeholder={placeholder}
          onChange={this.handleChange}
          onFocus={this.handleFocus}
          onBlur={this.handleBlur}
          onKeyDown={this.handleKeyDown}
        />
        {apiItems && opened ? (
          <ApiSuggestList
            suggestions={suggestions}
            activeIndex={activeIndex}
            onPick={this.pickApiItem}
          />
        ) : null}
      </div>
    );
  }
}

@FormItem({
  type: 'ae-apiUrlControl',
  renderLabel: false
})
export class ApiUrlControlRenderer extends ApiUrlControl {}
