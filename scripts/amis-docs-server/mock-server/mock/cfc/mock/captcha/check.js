/**
 * @file AJ-Captcha 协议 mock：POST /api/mock2/captcha/check
 *
 * 用 Node 内置 crypto 的 aes-128-ecb 解密 pointJson（协议：AES-ECB-PKCS7，
 * key 为 /captcha/get 返回的 secretKey），与 get 时存下的目标比对。
 * 这同时是对组件端手写 AES（CaptchaAes.ts）的端到端校验。
 * 各类型容差与后端一致：滑动拼图 x ±6（620 基准）、滑块曲线控制点 x ±8、点选逐点 ±12。
 */
const crypto = require('crypto');
const {tokens} = require('./store');

/**
 * 读取请求体：兼容 ①中间件已解析 ②原始流（vite 中间件无 body 解析）③query。
 * @param {any} req 请求
 * @returns {Promise<object>} 请求体对象
 */
function readBody(req) {
  return new Promise(resolve => {
    const fromQuery = () => req.query || {};
    if (req.body && typeof req.body === 'object' && Object.keys(req.body).length) {
      return resolve(req.body);
    }
    if (typeof req.body === 'string' && req.body.length) {
      try {
        return resolve(JSON.parse(req.body));
      } catch (e) {
        /* 继续读流 */
      }
    }
    if (typeof req.on !== 'function' || req.readableEnded || req.complete) {
      return resolve(fromQuery());
    }
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      try {
        resolve(raw ? JSON.parse(raw) : fromQuery());
      } catch (e) {
        resolve(fromQuery());
      }
    });
  });
}

/**
 * 解密 pointJson（AES-128-ECB-PKCS7，输出 UTF-8 JSON 字符串）。
 * @param {string} pointJson base64 密文
 * @param {string} secretKey 16 位密钥
 * @returns {string} 明文 JSON
 */
function decrypt(pointJson, secretKey) {
  const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(secretKey, 'utf8'), null);
  return Buffer.concat([d.update(Buffer.from(pointJson, 'base64')), d.final()]).toString(
    'utf8'
  );
}

/**
 * mock handler：/captcha/check
 * @param {any} req 请求
 * @param {any} res 响应
 * @returns void
 */
const handler = async function (req, res) {
  const body = await readBody(req);
  const token = body.token;
  const info = token && tokens.get(token);

  // 验证码一次一失效
  if (info) {
    tokens.delete(token);
  }
  if (!info || info.captchaType !== body.captchaType) {
    return res.json({repCode: '6110', repMsg: '验证码已失效，请刷新后重试'});
  }

  let point;
  try {
    point = JSON.parse(decrypt(body.pointJson, info.secretKey));
  } catch (e) {
    return res.json({repCode: '6111', repMsg: '验证失败'});
  }

  let pass = false;
  if (body.captchaType === 'clickWord') {
    // 点选：按顺序逐点比对字符中心（容差 12px）
    pass =
      Array.isArray(point) &&
      point.length === (info.targets || []).length &&
      point.every(
        (p, i) =>
          Math.abs(p.x - info.targets[i].x) <= 12 &&
          Math.abs(p.y - info.targets[i].y) <= 12
      );
  } else {
    // 滑动拼图 ±6（620 基准）；滑块曲线控制点 ±8
    const offset = body.captchaType === 'curveSlider' ? 8 : 6;
    pass = Math.abs(point.x - info.targetX) <= offset;
  }

  if (!pass) {
    return res.json({repCode: '6111', repMsg: '验证失败，请重试'});
  }
  return res.json({repCode: '0000', repData: {result: true}});
};

// 状态存放在 store.js；cache:false 让 mock 支持编辑热更新
handler.cache = false;
module.exports = handler;
