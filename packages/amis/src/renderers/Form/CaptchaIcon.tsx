/**
 * @file Captcha 专用图标。
 *
 * 图标来源（均经 better-icons MCP 获取的 Lucide 原始 SVG，非手绘）：
 * - lucide:shield-check：触发按钮"安全验证"语义
 * - lucide:check：成功结果层纯对勾
 * - lucide:rotate-cw：底部刷新（循环箭头，腾讯风格；用户原图待以文件形式提供后替换，
 *   长 base64 手工转录已证实会损坏，不走内联 data URI）
 */
import React from 'react';

export interface IconProps extends React.SVGProps<SVGSVGElement> {}

/**
 * 刷新图标（Lucide refresh-cw，纯线性描边——去掉路径级 fill 还原官方形态，
 * 实心填充在小尺寸下发糊）。
 * @param props SVG 属性透传
 * @returns JSX
 */
export function RefreshCwIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path d="M3 12a9 9 0 0 1 9-9a9.75 9.75 0 0 1 6.74 2.74L21 8" />
        <path d="M21 3v5h-5" />
        <path d="M21 12a9 9 0 0 1-9 9a9.75 9.75 0 0 1-6.74-2.74L3 16" />
        <path d="M8 16H3v5" />
      </g>
    </svg>
  );
}

/**
 * 纯打勾图标（Lucide check，currentColor 描边）。
 * 成功结果层用它做"绿色大对勾"，区别于带圆底的 success 图标。
 * @param props SVG 属性透传
 * @returns JSX
 */
export function CheckIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      <path
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2.5"
        d="M20 6L9 17l-5-5"
      />
    </svg>
  );
}

/**
 * 盾牌对勾图标（Lucide shield-check，currentColor 描边，随文字颜色）。
 * @param props SVG 属性透传
 * @returns JSX
 */
export function ShieldCheckIcon(props: IconProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="1em"
      height="1em"
      viewBox="0 0 24 24"
      {...props}
    >
      <g
        fill="none"
        stroke="currentColor"
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth="2"
      >
        <path
          fill="currentColor"
          d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
        />
        <path fill="currentColor" d="m9 12l2 2l4-4" />
      </g>
    </svg>
  );
}
