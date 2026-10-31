/**
 * @file 行为验证码等接口的独立 mock 服务（express 包装）。
 *
 * 作用：把仓库 mock/index.js 的 handler 挂到 /api 路径，供文档站 nginx
 *       以 /amis/api/ 同源反代，行为与本地 dev（vite mockApiPlugin）一致。
 * 参数：环境变量 PORT（默认 3001）
 * 返回：常驻 http 服务
 * 异常：mock 目录缺失或端口被占时进程退出
 */
import express from 'express';
import {createRequire} from 'node:module';
const mockHandler = createRequire(import.meta.url)('./mock/index');

const app = express();
app.use('/api', (req, res) => {
  // mock/index.js 是 CJS 且自行读取原始请求体，express 无需 body 中间件
  mockHandler(req, res);
});

// 健康检查（nginx/监控探活用）
app.get('/healthz', (req, res) => res.end('ok'));

app.listen(process.env.PORT || 3001, '0.0.0.0', () => {
  console.log(`amis mock listening on ${process.env.PORT || 3001}`);
});
