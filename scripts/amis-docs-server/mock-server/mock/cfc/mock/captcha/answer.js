/**
 * @file mock 辅助接口：POST/GET /api/mock2/captcha/answer?token=xxx
 *
 * 返回指定 token 的验证目标（滑动拼图 targetX / 曲线 targetX / 点选 targets）。
 * 仅供本地 demo 自动化测试使用（组件本身不感知该接口）——真实 AJ-Captcha
 * 后端没有也不应有此能力。不删除 token，答案仍一次性。
 */
const {tokens} = require('./store');

/**
 * mock handler：/captcha/answer
 * @param {any} req 请求
 * @param {any} res 响应
 * @returns void
 */
const handler = function (req, res) {
  const token = (req.query && req.query.token) || '';
  const info = token && tokens.get(token);
  if (!info) {
    return res.json({repCode: '6110', repMsg: 'token 不存在或已失效'});
  }
  res.json({
    repCode: '0000',
    repData: {captchaType: info.captchaType, targetX: info.targetX, targets: info.targets}
  });
};

// 状态存放在 store.js；cache:false 让 mock 支持编辑热更新
handler.cache = false;
module.exports = handler;
