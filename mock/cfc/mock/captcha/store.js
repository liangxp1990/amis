/**
 * @file captcha mock 的共享状态：token → 验证目标信息。
 *
 * `module.exports.cache = true` 告诉 mock 路由（mock/cfc/mock/index.js）
 * 不要清除本模块的 require 缓存，保证 get/check 两个 handler 共享同一份状态。
 */

/** @type {Map<string, {captchaType: string, secretKey: string, targetX?: number, targets?: Array<{x:number,y:number}>}>} */
const tokens = new Map();

/**
 * 生成随机字符串。
 * @param {number} len 长度
 * @returns {string} 随机字符串
 */
function randomStr(len) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let s = '';
  for (let i = 0; i < len; i++) {
    s += chars[Math.floor(Math.random() * chars.length)];
  }
  return s;
}

module.exports = {tokens, randomStr, cache: true};
