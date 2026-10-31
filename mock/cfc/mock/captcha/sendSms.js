/**
 * @file mock：POST /api/mock2/captcha/sendSms —— 发送短信演示接口。
 *
 * 模拟真实后端职责：收到带 captchaVerification 的请求后，
 * 先调验证码服务的 POST /captcha/verify 做二次校验，通过后再发短信。
 * 这里直接返回成功，让"发送短信 + 行为验证"联动示例可完整跑通。
 */
const handler = function (req, res) {
  const body =
    (req.body && typeof req.body === 'object' && Object.keys(req.body).length
      ? req.body
      : req.query) || {};
  if (!body.captchaVerification) {
    return res.json({status: 500, msg: '缺少验证码凭证，请先完成行为验证'});
  }
  res.json({
    status: 0,
    msg: '验证通过，短信已发送（mock）',
    data: {mobile: body.mobile || '', expireSeconds: 60}
  });
};

handler.cache = false;
module.exports = handler;
