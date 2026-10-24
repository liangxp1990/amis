---
title: Captcha 验证码
description:
type: 0
group: null
menuName: Captcha 验证码
icon:
order: 55
---

行为验证码表单项，协议兼容 [AJ-Captcha（anji-plus/captcha）](https://gitee.com/belief-team/captcha) 后端，支持**滑动拼图**、**滑块曲线**与**点选文字**三种验证形式，可内嵌展示或点击弹出。

用户完成行为校验后，组件会生成二次校验凭证（`captchaVerification`）写入当前表单字段，业务提交时随表单传给后端，由后端调用验证码服务的 `/captcha/verify` 做最终核验。

## 基本用法（滑动拼图）

```schema: scope="body"
{
  "type": "form",
  "debug": true,
  "body": [
    {
      "type": "captcha",
      "name": "captchaVerification",
      "label": "验证码",
      "getApi": "post:/api/mock2/captcha/get",
      "checkApi": "post:/api/mock2/captcha/check"
    }
  ]
}
```

拖动滑块把拼图对准缺口，校验通过后 `captchaVerification`（`debug` 面板可见）即为可提交给后端的凭证；校验失败会自动刷新一局。

## 点选文字

`captchaType` 设为 `clickWord`，按提示条中的文字顺序点击图中字符：

```schema: scope="body"
{
  "type": "form",
  "debug": true,
  "body": [
    {
      "type": "captcha",
      "name": "captchaVerification",
      "label": "点选验证",
      "captchaType": "clickWord",
      "getApi": "post:/api/mock2/captcha/get",
      "checkApi": "post:/api/mock2/captcha/check"
    }
  ]
}
```

## 滑块曲线

`captchaType` 设为 `curveSlider`，底图上有一条灰色目标曲线，拖动滑块改变蓝色活动曲线的弧度，两条曲线重合即通过（容差与后端一致）：

```schema: scope="body"
{
  "type": "form",
  "debug": true,
  "body": [
    {
      "type": "captcha",
      "name": "captchaVerification",
      "label": "曲线验证",
      "captchaType": "curveSlider",
      "getApi": "post:/api/mock2/captcha/get",
      "checkApi": "post:/api/mock2/captcha/check"
    }
  ]
}
```

## 弹出模式

`displayMode` 设为 `popup`，点击按钮弹出验证窗口，适合登录页等空间紧张的场景。验证通过后按钮保持绿色"验证通过"（凭证已写入表单），再次点击可重新验证：

```schema: scope="body"
{
  "type": "form",
  "body": [
    {
      "type": "captcha",
      "name": "captchaVerification",
      "label": "验证码",
      "displayMode": "popup",
      "actionText": "点击完成人机验证",
      "getApi": "post:/api/mock2/captcha/get",
      "checkApi": "post:/api/mock2/captcha/check"
    }
  ]
}
```

## 通过组件动作触发（发送短信场景）

弹出验证的唤起权可以交给**任意组件**：给 captcha 配 `id` 并设 `hideTrigger` 隐藏自带按钮，其他按钮通过[组件动作](../../concepts/event-action.md) `open` 唤起弹窗；验证成功的 `success` 事件里再调用真实业务接口（后端先做验证码二次校验再执行业务，如发短信）：

```schema: scope="body"
{
  "type": "form",
  "body": [
    {
      "type": "input-text",
      "name": "mobile",
      "label": "手机号",
      "value": "13800138000",
      "addOn": {
        "type": "button",
        "label": "发送短信",
        "onEvent": {
          "click": {
            "actions": [
              {
                "actionType": "open",
                "componentId": "smsCaptcha"
              }
            ]
          }
        }
      }
    },
    {
      "type": "captcha",
      "id": "smsCaptcha",
      "name": "captchaVerification",
      "label": "行为验证",
      "displayMode": "popup",
      "hideTrigger": true,
      "getApi": "post:/api/mock2/captcha/get",
      "checkApi": "post:/api/mock2/captcha/check",
      "onEvent": {
        "success": {
          "actions": [
            {
              "actionType": "ajax",
              "args": {
                "api": {
                  "url": "/api/mock2/captcha/sendSms",
                  "method": "post",
                  "data": {
                    "mobile": "${mobile}",
                    "captchaVerification": "${captchaVerification}"
                  }
                }
              }
            },
            {
              "actionType": "toast",
              "args": {"msgType": "success", "msg": "验证通过，短信已发送"}
            }
          ]
        },
        "fail": {
          "actions": [
            {
              "actionType": "toast",
              "args": {"msgType": "error", "msg": "验证失败，请重试"}
            }
          ]
        }
      }
    }
  ]
}
```

流程：点击"发送短信" → `open` 动作唤起行为验证弹窗 → 用户完成拖动/点选 → 后端 `/captcha/check` 通过 → 组件生成 `captchaVerification` 写入表单并触发 `success` → 调用发送短信接口（业务后端先拿 `captchaVerification` 调 `/captcha/verify` 二次校验，通过后真正发短信）。

## 后端对接

组件默认请求 `post:/captcha/get` 与 `post:/captcha/check`（AJ-Captcha 标准端点），通过 `getApi`/`checkApi` 可改为任意地址，支持 [API](../../types/api.md) 的所有配置（如 `requestAdaptor` 适配非标准后端）。

交互协议（与官方实现一致）：

1. `POST {getApi}` `{captchaType, clientUid, ts}` → `repData: {originalImageBase64, jigsawImageBase64?, token, secretKey, wordList?}`
2. 用户完成行为后，坐标用 `secretKey` 做 AES-ECB 加密为 `pointJson` 提交 `POST {checkApi}` `{captchaType, pointJson, token}`
3. 校验通过后组件生成 `captchaVerification = AES(token + "---" + 坐标JSON, secretKey)` 写入表单字段
4. 业务后端拿到表单里的 `captchaVerification`，调用验证码服务 `POST /captcha/verify` 完成最终核验（一次有效）

> 坐标基准：滑动拼图 x 按 620 基准、y 恒为 5；滑块曲线把滑块位移映射为曲线控制点 x（y 恒为 0，容差 ±8）；点选文字按 310x155 基准，组件已按显示宽度自动换算。曲线模式下 `/captcha/get` 的 `jigsawImageBase64` 字段返回的是曲线参数 JSON（非图片），组件据此用 Canvas 实时绘制活动曲线。

## 属性表

| 属性名 | 类型 | 默认值 | 说明 |
| --- | --- | --- | --- |
| type | `string` | `"captcha"` | 指定为 captcha 验证码组件 |
| captchaType | `string` | `"blockPuzzle"` | 验证码类型：`blockPuzzle` 滑动拼图 / `curveSlider` 滑块曲线 / `clickWord` 点选文字 |
| getApi | [API](../../types/api.md) | `"post:/captcha/get"` | 获取验证码图片接口 |
| checkApi | [API](../../types/api.md) | `"post:/captcha/check"` | 行为校验接口 |
| displayMode | `string` | `"embed"` | 展示形态：`embed` 内嵌 / `popup` 弹出（`mode` 是表单布局属性，勿混用） |
| actionText | `string` | `"点击进行验证"` | 弹出模式的触发按钮文案 |
| hideTrigger | `boolean` | `false` | 隐藏自带触发按钮，由外部组件通过组件动作 `open` 唤起（如"发送短信"场景） |
| width | `number` | `310` | 验证码显示宽度（px），图片按 2:1 等比显示 |

## 事件表

| 事件名 | 说明 | 回调参数 |
| --- | --- | --- |
| change | 验证通过、值写入前触发，可 `preventDefault` 阻止写入 | `value: captchaVerification` |
| success | 验证成功 | `value`、`captchaVerification`、`token`、`captchaType`、`points`（提交的坐标） |
| fail | 校验失败 | `msg: 失败原因` |

```schema: scope="body"
{
  "type": "form",
  "body": [
    {
      "type": "captcha",
      "name": "captchaVerification",
      "label": "验证码",
      "getApi": "post:/api/mock2/captcha/get",
      "checkApi": "post:/api/mock2/captcha/check",
      "onEvent": {
        "success": {
          "actions": [
            {
              "actionType": "toast",
              "args": {"msgType": "success", "msg": "验证成功，凭证已写入表单"}
            }
          ]
        },
        "fail": {
          "actions": [
            {
              "actionType": "toast",
              "args": {"msgType": "error", "msg": "验证失败，请重试"}
            }
          ]
        }
      }
    }
  ]
}
```

## 动作表

组件支持通过[组件动作](../../concepts/event-action.md)调用：

| 动作类型 | 说明 |
| --- | --- |
| open | 唤起弹出验证（仅弹出形态；已验证时先清值并重新出一局） |
| refresh | 刷新验证码（重新出一局） |
| clear | 清空已验证的值并刷新 |
| reset | 恢复初始值并刷新 |
