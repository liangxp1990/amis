/**
 * @file 用于模拟 cfc 接口
 *
 * 说明：本地 dev（vite mockApiPlugin）没有 body 解析中间件，这里补读原始请求体，
 * 并把 Content-Type 头规范化为 cfc 层 mockRequest 认识的大小写（node 的 headers
 * 是全小写 'content-type'）。cfc 线上入口不受影响。
 */

// @ts-ignore
const cfcHandler = require('./cfc/index').handler;

/**
 * 读取原始请求体字符串。
 * @param {any} req 请求
 * @returns {Promise<string|undefined>} body 字符串（无 body 时 undefined）
 */
function readRawBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    let done = false;
    const finish = (v) => {
      if (!done) {
        done = true;
        resolve(v);
      }
    };
    req.on('data', c => chunks.push(c));
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(undefined));
  });
}

module.exports = async function (req, res) {
  const subpath = (req.originalUrl || req.url).replace(
    /^\/(api\/mock2|api)\/|\?.*$/g,
    ''
  );
  let body = req.body;
  if (
    body === undefined &&
    typeof req.on === 'function' &&
    !req.readableEnded &&
    req.method !== 'GET' &&
    req.method !== 'HEAD'
  ) {
    body = await readRawBody(req);
  }
  const contentType =
    req.headers?.['content-type'] || req.headers?.['Content-Type'] || '';
  const mockEvent = {
    queryStringParameters: req.query,
    pathParameters: {
      subpath
    },
    headers: Object.assign({}, req.headers, {'Content-Type': contentType}),
    body
  };
  const mockContext = {};

  cfcHandler(mockEvent, mockContext, (err, result) => {
    if (err) {
      console.error(err);
      res.status(500).json({status: 500, msg: err});
    } else {
      res.set(result.headers);
      if (result.download) {
        res.download(result.download);
      } else if (!result.json) {
        res.status(result.statusCode).send(result.body);
      } else {
        res.status(result.statusCode).json(JSON.parse(result.body));
      }
    }
  });
};
