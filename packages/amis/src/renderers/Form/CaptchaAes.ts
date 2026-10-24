/**
 * @file AJ-Captcha 协议所需的 AES-128-ECB-PKCS7 加密工具。
 *
 * 背景：AJ-Captcha（anji-plus/captcha）后端要求前端把用户行为轨迹（pointJson）
 * 用 /captcha/get 响应中的 secretKey（16 位字符串 → AES-128）加密后提交到
 * /captcha/check。协议参考官方 vue 实现 view/vue/src/components/verifition/utils/ase.js
 * （crypto-js AES-ECB-Pkcs7，输出 base64）。此处以原生实现替代 crypto-js 依赖，
 * 正确性由 FIPS-197 标准测试向量覆盖（见 captchaAes.test.ts）。
 *
 * 注意：这是协议传输编码（防脚本直接提交明文坐标），不是安全加密——
 * 验证码的安全性由后端频控与行为分析保障。因此仅实现加密方向，不实现解密。
 */

/**
 * 构造 AES S 盒（GF(2^8) 乘法逆元 + 仿射变换）。
 *
 * 通过 log/exp 表（生成元 0x03）求逆，避免手写 256 项常量表出错，
 * 正确性由 FIPS-197 测试向量兜底。
 *
 * @returns 256 项 S 盒
 */
function buildSbox(): Uint8Array {
  const sbox = new Uint8Array(256);
  const exp = new Uint8Array(255);
  const log = new Uint8Array(256);
  let x = 1;
  for (let i = 0; i < 255; i++) {
    exp[i] = x;
    log[x] = i;
    // x *= 3（GF(2^8) 上乘以生成元 3 = x ^ xtime(x)）
    x = (x ^ ((x << 1) ^ ((x & 0x80 ? 0x1b : 0x00) & 0xff))) & 0xff;
  }
  const rotl8 = (v: number, s: number) => ((v << s) | (v >>> (8 - s))) & 0xff;
  for (let i = 0; i < 256; i++) {
    const inv = i === 0 ? 0 : exp[(255 - log[i]) % 255];
    sbox[i] = (inv ^ rotl8(inv, 1) ^ rotl8(inv, 2) ^ rotl8(inv, 3) ^ rotl8(inv, 4) ^ 0x63) & 0xff;
  }
  return sbox;
}

const SBOX = buildSbox();
const RCON = [0x01, 0x02, 0x04, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1b, 0x36];

/**
 * GF(2^8) 上的 xtime（乘 2）。
 * @param v 输入字节
 * @returns 乘 2 结果
 */
function xtime(v: number): number {
  return ((v << 1) ^ (v & 0x80 ? 0x1b : 0)) & 0xff;
}

/**
 * AES-128 密钥扩展（11 轮密钥，44 个 32 位字）。
 *
 * @param key 16 字节密钥
 * @returns 展开后的轮密钥字数组
 * @throws key 长度不是 16 字节时抛错
 */
function expandKey(key: Uint8Array): number[] {
  if (key.length !== 16) {
    throw new Error('CaptchaAes: secretKey must be 16 bytes (AES-128)');
  }
  const w: number[] = [];
  for (let i = 0; i < 4; i++) {
    w[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
  }
  for (let i = 4; i < 44; i++) {
    let t = w[i - 1];
    if (i % 4 === 0) {
      // RotWord + SubWord + Rcon
      const r =
        ((SBOX[(t >>> 16) & 0xff] << 24) >>> 0) +
        (SBOX[(t >>> 8) & 0xff] << 16) +
        (SBOX[t & 0xff] << 8) +
        SBOX[(t >>> 24) & 0xff];
      t = (r ^ (RCON[i / 4 - 1] << 24)) >>> 0;
    }
    w[i] = (w[i - 4] ^ t) >>> 0;
  }
  return w;
}

/**
 * 加密单个 16 字节块（ECB 模式下逐块独立加密）。
 *
 * @param block 16 字节明文块
 * @param w 展开后的轮密钥
 * @returns 16 字节密文块
 */
function encryptBlock(block: Uint8Array, w: number[]): Uint8Array {
  const s = new Uint8Array(block); // state
  const addRoundKey = (round: number) => {
    for (let c = 0; c < 4; c++) {
      const rk = w[round * 4 + c];
      for (let r = 0; r < 4; r++) {
        s[c * 4 + r] ^= (rk >>> (24 - r * 8)) & 0xff;
      }
    }
  };

  addRoundKey(0);
  for (let round = 1; round <= 10; round++) {
    // SubBytes
    for (let i = 0; i < 16; i++) {
      s[i] = SBOX[s[i]];
    }
    // ShiftRows（state 按列主序：s[c*4+r]）
    for (let r = 1; r < 4; r++) {
      const row = [s[r], s[4 + r], s[8 + r], s[12 + r]];
      for (let c = 0; c < 4; c++) {
        s[c * 4 + r] = row[(c + r) % 4];
      }
    }
    // MixColumns（末轮跳过）
    if (round < 10) {
      for (let c = 0; c < 4; c++) {
        const a0 = s[c * 4],
          a1 = s[c * 4 + 1],
          a2 = s[c * 4 + 2],
          a3 = s[c * 4 + 3];
        s[c * 4] = xtime(a0) ^ (xtime(a1) ^ a1) ^ a2 ^ a3;
        s[c * 4 + 1] = a0 ^ xtime(a1) ^ (xtime(a2) ^ a2) ^ a3;
        s[c * 4 + 2] = a0 ^ a1 ^ xtime(a2) ^ (xtime(a3) ^ a3);
        s[c * 4 + 3] = (xtime(a0) ^ a0) ^ a1 ^ a2 ^ xtime(a3);
      }
    }
    addRoundKey(round);
  }
  return s;
}

/**
 * 按 PKCS#7 规则填充到 16 字节块边界。
 * @param data 原始字节
 * @returns 填充后的字节（长度为 16 的整数倍）
 */
function pkcs7Pad(data: Uint8Array): Uint8Array {
  const pad = 16 - (data.length % 16);
  const out = new Uint8Array(data.length + pad);
  out.set(data);
  out.fill(pad, data.length);
  return out;
}

/**
 * 字节数组转 base64。
 * @param bytes 输入字节
 * @returns base64 字符串
 */
function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return typeof btoa === 'function'
    ? btoa(binary)
    : Buffer.from(bytes).toString('base64');
}

/**
 * 字符串转 UTF-8 字节（不用 TextEncoder：jsdom 测试环境没有该全局，且老浏览器缺失）。
 * @param str 输入字符串
 * @returns UTF-8 字节数组
 */
function utf8Bytes(str: string): Uint8Array {
  const bin = unescape(encodeURIComponent(str));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    out[i] = bin.charCodeAt(i);
  }
  return out;
}

/**
 * AES-128-ECB-PKCS7 加密（兼容 crypto-js 的 ECB/Pkcs7 输出，base64）。
 *
 * 用于把 captcha 的用户行为轨迹（如 `{"x":83,"y":5}`）加密为 pointJson。
 *
 * @param plain 明文字符串（UTF-8）
 * @param secretKey 16 位密钥字符串（AJ-Captcha 后端 /captcha/get 返回）
 * @returns base64 密文
 * @throws secretKey 不是 16 位时抛错
 */
export function captchaAesEncrypt(plain: string, secretKey: string): string {
  if (typeof secretKey !== 'string' || secretKey.length !== 16) {
    throw new Error('CaptchaAes: secretKey must be 16 bytes (AES-128)');
  }
  const keyBytes = new Uint8Array(16);
  const src = utf8Bytes(plain);
  for (let i = 0; i < 16; i++) {
    keyBytes[i] = secretKey.charCodeAt(i) & 0xff;
  }
  const w = expandKey(keyBytes);
  const padded = pkcs7Pad(src);
  const out = new Uint8Array(padded.length);
  for (let off = 0; off < padded.length; off += 16) {
    out.set(encryptBlock(padded.subarray(off, off + 16), w), off);
  }
  return toBase64(out);
}
