/**
 * @file mock 用最小 PNG 编解码器：程序化合成验证码图片，无任何第三方依赖。
 *
 * - encodePng：RGBA 缓冲 → PNG base64（zlib deflate + IHDR/IDAT/IEND）
 * - decodePng：PNG base64 → {width, height, rgba}（支持 8bit RGB/RGBA，覆盖 5 种扫描线滤波）
 * 用于加载 AJ-Captcha SpringBoot demo 的默认底图并在其上随机抠图/画曲线。
 */
const zlib = require('zlib');

/**
 * CRC32（PNG chunk 校验用）。
 * @param {Buffer} buf 输入字节
 * @returns {number} CRC32 值
 */
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      }
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

/**
 * 把 RGBA 像素缓冲编码为 PNG base64。
 * @param {number} width 宽
 * @param {number} height 高
 * @param {Uint8Array} rgba 像素数据（w*h*4）
 * @returns {string} PNG 文件的 base64（不带 data: 前缀）
 */
function encodePng(width, height, rgba) {
  // 每行前置 filter 类型 0（None）
  const raw = Buffer.alloc(height * (width * 4 + 1));
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * (width * 4 + 1) + 1
    );
  }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([len, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0))
  ]);
  return png.toString('base64');
}

/**
 * 解码 PNG base64 为 RGBA（支持 8bit RGB(2)/RGBA(6)）。
 * @param {string} base64 PNG base64
 * @returns {{width: number, height: number, rgba: Uint8Array}}
 * @throws 非法签名或暂不支持的格式时抛错
 */
function decodePng(base64) {
  const buf = Buffer.from(base64, 'base64');
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  for (let i = 0; i < 8; i++) {
    if (buf[i] !== sig[i]) {
      throw new Error('not a png');
    }
  }
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = 0;
  const idat = [];
  let off = 8;
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
    off += 12 + len;
  }
  if (bitDepth !== 8 || (colorType !== 6 && colorType !== 2)) {
    throw new Error(`unsupported png: bitDepth=${bitDepth} colorType=${colorType}`);
  }
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const bpp = colorType === 6 ? 4 : 3;
  const stride = width * bpp;
  const rgba = new Uint8Array(width * height * 4);
  let prev = Buffer.alloc(stride);
  let pos = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++];
    const cur = Buffer.from(raw.subarray(pos, pos + stride));
    pos += stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;
      const b = prev[x];
      const c = x >= bpp ? prev[x - bpp] : 0;
      if (filter === 1) {
        cur[x] = (cur[x] + a) & 0xff;
      } else if (filter === 2) {
        cur[x] = (cur[x] + b) & 0xff;
      } else if (filter === 3) {
        cur[x] = (cur[x] + ((a + b) >> 1)) & 0xff;
      } else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        cur[x] =
          (cur[x] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 0xff;
      }
    }
    for (let x = 0; x < width; x++) {
      const s = x * bpp;
      const d = (y * width + x) * 4;
      rgba[d] = cur[s];
      rgba[d + 1] = cur[s + 1];
      rgba[d + 2] = cur[s + 2];
      rgba[d + 3] = colorType === 6 ? cur[s + 3] : 255;
    }
    prev = cur;
  }
  return {width, height, rgba};
}

/**
 * 画布：纯 JS 像素绘制（无依赖），验证码图形够用。
 * 可从纯色创建，也可由 decodePng 的结果创建（在其上继续作画）。
 */
class Canvas {
  /**
   * @param {number} width 画布宽
   * @param {number} height 画布高
   * @param {[number, number, number, number]} bg 背景色 RGBA
   */
  constructor(width, height, bg) {
    this.width = width;
    this.height = height;
    this.px = new Uint8Array(width * height * 4);
    this.fill(0, 0, width, height, bg);
  }

  /**
   * 由解码图构造画布（共享像素缓冲，修改即改原图）。
   * @param {{width: number, height: number, rgba: Uint8Array}} img decodePng 结果
   * @returns {Canvas}
   */
  static fromImage(img) {
    const c = new Canvas(1, 1, [0, 0, 0, 0]);
    c.width = img.width;
    c.height = img.height;
    c.px = img.rgba;
    return c;
  }

  /**
   * 填充矩形。
   * @param {number} x 左上 x
   * @param {number} y 左上 y
   * @param {number} w 宽
   * @param {number} h 高
   * @param {[number, number, number, number]} color RGBA
   */
  fill(x, y, w, h, color) {
    x = Math.floor(x);
    y = Math.floor(y);
    w = Math.floor(w);
    h = Math.floor(h);
    for (let j = Math.max(0, y); j < Math.min(this.height, y + h); j++) {
      for (let i = Math.max(0, x); i < Math.min(this.width, x + w); i++) {
        const o = (j * this.width + i) * 4;
        const a = color[3] / 255;
        this.px[o] = Math.round(this.px[o] * (1 - a) + color[0] * a);
        this.px[o + 1] = Math.round(this.px[o + 1] * (1 - a) + color[1] * a);
        this.px[o + 2] = Math.round(this.px[o + 2] * (1 - a) + color[2] * a);
        this.px[o + 3] = Math.max(this.px[o + 3], color[3]);
      }
    }
  }

  /**
   * 画实心圆。
   * @param {number} cx 圆心 x
   * @param {number} cy 圆心 y
   * @param {number} r 半径
   * @param {[number, number, number, number]} color RGBA
   */
  circle(cx, cy, r, color) {
    cx = Math.round(cx);
    cy = Math.round(cy);
    for (let j = Math.max(0, cy - r); j <= Math.min(this.height - 1, cy + r); j++) {
      for (let i = Math.max(0, cx - r); i <= Math.min(this.width - 1, cx + r); i++) {
        if ((i - cx) * (i - cx) + (j - cy) * (j - cy) <= r * r) {
          this.fill(i, j, 1, 1, color);
        }
      }
    }
  }

  /**
   * 画 5x7 点阵字符（ASCII A-Z、0-9）。
   * @param {number} x 左上 x
   * @param {number} y 左上 y
   * @param {string} ch 字符
   * @param {[number, number, number, number]} color RGBA
   */
  char(x, y, ch, color) {
    const glyph = FONT[ch.toUpperCase()];
    if (!glyph) {
      return;
    }
    for (let row = 0; row < 7; row++) {
      for (let col = 0; col < 5; col++) {
        if (glyph[row] & (1 << (4 - col))) {
          this.fill(x + col, y + row, 1, 1, color);
        }
      }
    }
  }

  /**
   * 画字符串（字符间 1px 间隔）。
   * @param {number} x 左上 x
   * @param {number} y 左上 y
   * @param {string} text 文本
   * @param {[number, number, number, number]} color RGBA
   */
  text(x, y, text, color) {
    for (let i = 0; i < text.length; i++) {
      this.char(x + i * 6, y, text[i], color);
    }
  }

  /**
   * 画二次贝塞尔曲线（密集采样圆点近似，视觉上为平滑曲线）。
   * @param {number} x0 起点x
   * @param {number} y0 起点y
   * @param {number} cx 控制点x
   * @param {number} cy 控制点y
   * @param {number} x1 终点x
   * @param {number} y1 终点y
   * @param {[number, number, number, number]} color RGBA
   * @param {number} widthPx 线宽（点直径）
   */
  quadCurve(x0, y0, cx, cy, x1, y1, color, widthPx = 3) {
    const r = widthPx / 2;
    for (let t = 0; t <= 1.0001; t += 1 / 240) {
      const mt = 1 - t;
      const px = mt * mt * x0 + 2 * mt * t * cx + t * t * x1;
      const py = mt * mt * y0 + 2 * mt * t * cy + t * t * y1;
      this.circle(px, py, r, color);
    }
  }

  /**
   * 输出 PNG base64。
   * @returns {string} base64（不带 data: 前缀）
   */
  toBase64() {
    return encodePng(this.width, this.height, this.px);
  }
}

/** 5x7 点阵字体（A-Z 0-9），供点选文字验证码绘制字符 */
const FONT = {
  A: [0x0e, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  B: [0x1e, 0x11, 0x11, 0x1e, 0x11, 0x11, 0x1e],
  C: [0x0e, 0x11, 0x10, 0x10, 0x10, 0x11, 0x0e],
  D: [0x1c, 0x12, 0x11, 0x11, 0x11, 0x12, 0x1c],
  E: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x1f],
  F: [0x1f, 0x10, 0x10, 0x1e, 0x10, 0x10, 0x10],
  G: [0x0e, 0x11, 0x10, 0x17, 0x11, 0x11, 0x0f],
  H: [0x11, 0x11, 0x11, 0x1f, 0x11, 0x11, 0x11],
  I: [0x0e, 0x04, 0x04, 0x04, 0x04, 0x04, 0x0e],
  J: [0x07, 0x02, 0x02, 0x02, 0x02, 0x12, 0x0c],
  K: [0x11, 0x12, 0x14, 0x18, 0x14, 0x12, 0x11],
  L: [0x10, 0x10, 0x10, 0x10, 0x10, 0x10, 0x1f],
  M: [0x11, 0x1b, 0x15, 0x15, 0x11, 0x11, 0x11],
  N: [0x11, 0x19, 0x15, 0x13, 0x11, 0x11, 0x11],
  O: [0x0e, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  P: [0x1e, 0x11, 0x11, 0x1e, 0x10, 0x10, 0x10],
  Q: [0x0e, 0x11, 0x11, 0x11, 0x15, 0x12, 0x0d],
  R: [0x1e, 0x11, 0x11, 0x1e, 0x14, 0x12, 0x11],
  S: [0x0f, 0x10, 0x10, 0x0e, 0x01, 0x01, 0x1e],
  T: [0x1f, 0x04, 0x04, 0x04, 0x04, 0x04, 0x04],
  U: [0x11, 0x11, 0x11, 0x11, 0x11, 0x11, 0x0e],
  V: [0x11, 0x11, 0x11, 0x11, 0x11, 0x0a, 0x04],
  W: [0x11, 0x11, 0x11, 0x15, 0x15, 0x1b, 0x11],
  X: [0x11, 0x11, 0x0a, 0x04, 0x0a, 0x11, 0x11],
  Y: [0x11, 0x11, 0x0a, 0x04, 0x04, 0x04, 0x04],
  Z: [0x1f, 0x01, 0x02, 0x04, 0x08, 0x10, 0x1f],
  '0': [0x0e, 0x11, 0x13, 0x15, 0x19, 0x11, 0x0e],
  '1': [0x04, 0x0c, 0x04, 0x04, 0x04, 0x04, 0x0e],
  '2': [0x0e, 0x11, 0x01, 0x02, 0x04, 0x08, 0x1f],
  '3': [0x0e, 0x11, 0x01, 0x06, 0x01, 0x11, 0x0e],
  '4': [0x02, 0x06, 0x0a, 0x12, 0x1f, 0x02, 0x02],
  '5': [0x1f, 0x10, 0x1e, 0x01, 0x01, 0x11, 0x0e],
  '6': [0x0e, 0x10, 0x10, 0x1e, 0x11, 0x11, 0x0e],
  '7': [0x1f, 0x01, 0x02, 0x04, 0x08, 0x08, 0x08],
  '8': [0x0e, 0x11, 0x11, 0x0e, 0x11, 0x11, 0x0e],
  '9': [0x0e, 0x11, 0x11, 0x0f, 0x01, 0x01, 0x0e]
};

module.exports = {Canvas, encodePng, decodePng};
