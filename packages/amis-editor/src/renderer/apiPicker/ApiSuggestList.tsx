/**
 * apiPicker 联想下拉共享展示组件。
 * What: 按 tags[0] 分组（无 tags 平铺不显示组标题，保持 fuzzyMatch 排序）渲染
 *   接口候选列表，每项 = method 徽标 + 名称 + 路径；供 APIControl 外层输入框与
 *   高级设置弹窗内的 ae-apiUrlControl 复用。
 * Args: props.suggestions 候选列表（调用方已截断）; props.activeIndex 键盘导航
 *   激活下标（-1 无）; props.onPick 选中回调
 * Returns: 无候选时渲染 null
 */
import React from 'react';
import cx from 'classnames';
import type {ApiItem} from './types';

export interface ApiSuggestListProps {
  suggestions: ApiItem[];
  activeIndex: number;
  onPick: (item: ApiItem) => void;
}

export default class ApiSuggestList extends React.Component<ApiSuggestListProps> {
  render() {
    const {suggestions, activeIndex, onPick} = this.props;
    if (!suggestions.length) {
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
                /* 阻止 mousedown 抢焦点导致外层 Input 先 blur 收起下拉
                   （容器级拦截同时覆盖分组标题/内边距/间隙等非条目区域） */
                onMouseDown={e => e.preventDefault()}
                onClick={() => onPick(item)}
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
}
