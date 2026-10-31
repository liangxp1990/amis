/**
 * @file AJ-Captcha 协议 mock：POST /api/mock2/captcha/get
 *
 * 底图数据取自 anji-plus/captcha SpringBoot demo 的默认图资源（assets.js，
 * 由 node-canvas 预转换的 PNG base64），运行时在其上随机合成：
 * - blockPuzzle：按 slidingBlock 模板 alpha 抠图（拼图条 + 凹槽模糊 + 白描边 + 干扰凹槽），
 *   坐标协议与后端一致（提交 x 按 620 基准、y 恒为 5）
 * - curveSlider：在底图上画灰色目标 U 型曲线，jigsawImageBase64 返回曲线参数 JSON，
 *   校验容差与后端一致（控制点 x ±8px）
 * - clickWord：底图上按网格画点阵字符，按 wordList 顺序点选（310x155 基准）
 * assets 缺失时回退到程序化绘制，保证 mock 永远可用。
 */
const {Canvas, encodePng, decodePng} = require('./png');
const {tokens, randomStr} = require('./store');

let assets = {};
try {
  assets = require('./assets');
} catch (e) {
  assets = {};
}

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
 * 从资源池随机取一项（空池返回 undefined）。
 * @param {string[]} pool 资源数组
 * @returns {string|undefined}
 */
function pick(pool) {
  return Array.isArray(pool) && pool.length
    ? pool[Math.floor(Math.random() * pool.length)]
    : undefined;
}

/**
 * 按模板 alpha 在底图上抠图（简化复刻后端 cutByTemplate）：
 * alpha>200 内部像素 → 拼图取背景原色、底图凹槽做 3x3 高斯模糊；
 * 0<alpha<=200 边缘像素 → 底图与拼图按 alpha 混白描边。
 * @param {string} originalB64 底图（620x310）
 * @param {string} templateB64 滑块模板（全高条，含 alpha 形状）
 * @param {number} cutX 抠图左缘 x
 * @param {boolean} withPiece 是否产出拼图条（干扰凹槽传 false）
 * @returns {{bg: string, piece: string}} 处理后的底图与拼图条 base64
 */
function cutByTemplate(originalB64, templateB64, cutX, withPiece) {
  const img = decodePng(originalB64);
  const tpl = decodePng(templateB64);
  const src = img.rgba.slice(); // 原始像素备份，模糊取样用
  const piece = new Uint8Array(tpl.width * tpl.height * 4);
  const avg3x3 = (x, y) => {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dj = -1; dj <= 1; dj++) {
      for (let di = -1; di <= 1; di++) {
        if (!di && !dj) continue;
        const px = x + di, py = y + dj;
        if (px < 0 || px >= img.width || py < 0 || py >= img.height) continue;
        const s = (py * img.width + px) * 4;
        r += src[s]; g += src[s + 1]; b += src[s + 2]; n++;
      }
    }
    return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
  };
  for (let j = 0; j < tpl.height; j++) {
    for (let i = 0; i < tpl.width; i++) {
      const ta = tpl.rgba[(j * tpl.width + i) * 4 + 3];
      if (ta <= 0 || cutX + i < 0 || cutX + i >= img.width) continue;
      const bgIdx = (j * img.width + cutX + i) * 4;
      if (ta > 200) {
        if (withPiece) {
          piece.set([src[bgIdx], src[bgIdx + 1], src[bgIdx + 2], 255], (j * tpl.width + i) * 4);
        }
        const [r, g, b] = avg3x3(cutX + i, j);
        img.rgba[bgIdx] = r;
        img.rgba[bgIdx + 1] = g;
        img.rgba[bgIdx + 2] = b;
      } else {
        // 白描边（按 alpha 渐变混白，与后端视觉一致）
        const ratio = ta / 255;
        img.rgba[bgIdx] = Math.round(src[bgIdx] * (1 - ratio) + 255 * ratio);
        img.rgba[bgIdx + 1] = Math.round(src[bgIdx + 1] * (1 - ratio) + 255 * ratio);
        img.rgba[bgIdx + 2] = Math.round(src[bgIdx + 2] * (1 - ratio) + 255 * ratio);
        if (withPiece) {
          piece.set([255, 255, 255, ta], (j * tpl.width + i) * 4);
        }
      }
    }
  }
  return {
    bg: encodePng(img.width, img.height, img.rgba),
    piece: encodePng(tpl.width, tpl.height, piece)
  };
}

/**
 * 生成滑动拼图（真实底图模板抠图，缺资源回退程序化圆头）。
 * @returns {{originalImageBase64: string, jigsawImageBase64: string, targetX: number}}
 */
function makeBlockPuzzle() {
  const original = pick(assets.jigsawOriginals);
  const template = pick(assets.slidingBlocks);
  if (original && template) {
    const w = decodePng(original).width; // 只为拿宽度，抠图函数内部再解码一次，图量小可接受
    const tplW = decodePng(template).width;
    const min = 100;
    const max = Math.max(min + 1, w - tplW - 10);
    const holeX = min + Math.floor(Math.random() * (max - min));
    const main = cutByTemplate(original, template, holeX, true);
    // 干扰凹槽（不带拼图），位置远离主凹槽
    const far = Math.random() * Math.min(w - tplW, Math.max(0, holeX - tplW - 30));
    const decoyX = holeX > w / 2 ? far : Math.min(w - tplW, holeX + tplW + 30 + Math.random() * 100);
    let bg = main.bg;
    try {
      bg = cutByTemplate(main.bg, template, Math.round(decoyX), false).bg;
    } catch (e) {
      /* 干扰凹槽失败不影响主流程 */
    }
    return {
      originalImageBase64: bg,
      jigsawImageBase64: main.piece,
      targetX: holeX
    };
  }
  // 兜底：程序化圆头拼图
  const holeX = 130 + Math.round(Math.random() * 430);
  const c = new Canvas(620, 310, [225, 240, 252, 255]);
  for (let i = 0; i < 14; i++) {
    c.circle(Math.random() * 620, Math.random() * 310, 14 + Math.random() * 40, [
      180 + Math.random() * 60, 205 + Math.random() * 40, 240, 90
    ]);
  }
  for (let i = 0; i < 5; i++) {
    c.fill(0, 30 + i * 60, 620, 2, [255, 255, 255, 60]);
  }
  c.circle(holeX, 45, 30, [70, 90, 120, 235]);
  c.circle(holeX, 45, 30, [255, 255, 255, 255]);
  c.circle(holeX, 45, 26, [70, 90, 120, 235]);
  c.text(500, 290, 'AMIS DEMO', [255, 255, 255, 160]);
  const piece = new Canvas(94, 310, [0, 0, 0, 0]);
  piece.circle(40, 45, 30, [70, 110, 170, 255]);
  piece.circle(40, 45, 30, [255, 255, 255, 255]);
  piece.circle(40, 45, 26, [70, 110, 170, 255]);
  piece.fill(30, 45, 20, 40, [70, 110, 170, 255]);
  return {
    originalImageBase64: c.toBase64(),
    jigsawImageBase64: piece.toBase64(),
    targetX: holeX - 40
  };
}

/**
 * 生成滑块曲线（真实底图 + 灰色目标曲线 + 参数 JSON，协议同后端）。
 * @returns {{originalImageBase64: string, jigsawImageBase64: string, targetX: number}}
 */
function makeCurveSlider() {
  const original = pick(assets.curveOriginals);
  const w0 = 310;
  const h0 = 155;
  let c;
  if (original) {
    const img = decodePng(original);
    c = Canvas.fromImage(img);
  } else {
    c = new Canvas(w0, h0, [242, 246, 252, 255]);
    for (let i = 0; i < 200; i++) {
      c.fill(Math.random() * w0, Math.random() * h0, 2, 2, [
        150 + Math.random() * 80, 160 + Math.random() * 70, 190, 120
      ]);
    }
  }
  const w = c.width;
  const h = c.height;
  // 曲线参数与后端同公式（相对尺寸，任意底图可用）
  const startX = Math.round(w * 0.13);
  const endX = Math.round(w * 0.87);
  const topY = Math.round(h * 0.08);
  const bottomY = Math.round(h * 1.52);
  const ctrlXMin = Math.round(w * 0.2);
  const ctrlXMax = Math.round(w * 0.8);
  // 目标限制在行程 30%~100%，保证必须滑动
  const tMin = ctrlXMin + Math.round((ctrlXMax - ctrlXMin) * 0.3);
  const targetCtrlX = tMin + Math.floor(Math.random() * (ctrlXMax - tMin + 1));
  // 灰色半透明目标曲线 + 白端点
  c.quadCurve(startX, topY, targetCtrlX, bottomY, endX, topY, [180, 180, 180, 130], 3);
  c.circle(startX, topY, 5, [255, 255, 255, 255]);
  c.circle(endX, topY, 5, [255, 255, 255, 255]);
  c.text(w - 120, h - 16, 'AMIS DEMO', [255, 255, 255, 160]);
  return {
    originalImageBase64: c.toBase64(),
    jigsawImageBase64: JSON.stringify({
      startX, endX, topY, bottomY, ctrlXMin, ctrlXMax,
      imgWidth: w, imgHeight: h
    }),
    targetX: targetCtrlX
  };
}

/**
 * 生成点选文字（真实底图/兜底噪点底图 + 网格点阵字符）。
 * @returns {{originalImageBase64: string, wordList: string[], targets: Array<{x:number,y:number}>}}
 */
function makeClickWord() {
  const original = pick(assets.picClicks);
  let c;
  if (original) {
    c = Canvas.fromImage(decodePng(original));
  } else {
    c = new Canvas(310, 155, [242, 246, 252, 255]);
    for (let i = 0; i < 200; i++) {
      c.fill(Math.random() * 310, Math.random() * 155, 2, 2, [
        150 + Math.random() * 80, 160 + Math.random() * 70, 190, 120
      ]);
    }
  }
  const letters = [];
  const used = new Set();
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const cols = 3;
  const cellW = c.width / cols;
  const cellH = c.height / 2;
  for (let cell = 0; cell < cols * 2; cell++) {
    const col = cell % cols;
    const row = Math.floor(cell / cols);
    let ch;
    do {
      ch = alpha[Math.floor(Math.random() * alpha.length)];
    } while (used.has(ch));
    used.add(ch);
    const x = col * cellW + cellW * 0.15 + Math.random() * cellW * 0.3;
    const y = row * cellH + cellH * 0.15 + Math.random() * cellH * 0.25;
    const color = [
      [50, 100, 220, 255],
      [220, 90, 90, 255],
      [60, 150, 90, 255],
      [200, 140, 40, 255]
    ][Math.floor(Math.random() * 4)];
    c.text(x, y, ch, color);
    letters.push({ch, x: Math.round(x + 2), y: Math.round(y + 3)}); // 字符视觉中心
  }
  const picked = letters.slice(0, 3);
  return {
    originalImageBase64: c.toBase64(),
    wordList: picked.map(l => l.ch),
    targets: picked.map(l => ({x: l.x, y: l.y}))
  };
}

/**
 * mock handler：/captcha/get
 * @param {any} req 请求
 * @param {any} res 响应
 * @returns void
 */
const handler = async function (req, res) {
  const body = await readBody(req);
  const captchaType = body.captchaType || 'blockPuzzle';
  const token = randomStr(32);
  const secretKey = randomStr(16);
  let repData;

  if (captchaType === 'clickWord') {
    const made = makeClickWord();
    tokens.set(token, {captchaType, secretKey, targets: made.targets});
    repData = {
      originalImageBase64: made.originalImageBase64,
      token,
      secretKey,
      wordList: made.wordList
    };
  } else if (captchaType === 'curveSlider') {
    const made = makeCurveSlider();
    tokens.set(token, {captchaType, secretKey, targetX: made.targetX});
    repData = {
      originalImageBase64: made.originalImageBase64,
      jigsawImageBase64: made.jigsawImageBase64,
      token,
      secretKey
    };
  } else {
    const made = makeBlockPuzzle();
    tokens.set(token, {captchaType: 'blockPuzzle', secretKey, targetX: made.targetX});
    repData = {
      originalImageBase64: made.originalImageBase64,
      jigsawImageBase64: made.jigsawImageBase64,
      token,
      secretKey
    };
  }

  res.json({repCode: '0000', repData});
};

// 状态存放在 store.js；cache:false 让 mock 支持编辑热更新
handler.cache = false;
module.exports = handler;
