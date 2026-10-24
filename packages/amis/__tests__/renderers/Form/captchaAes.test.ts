/**
 * 组件名称：CaptchaAes 行为验证码加密工具
 * 单测内容：
 * 1. PKCS7 填充边界：单块输入补一整块、key 非 16 位抛错
 * 2. 与 Node crypto（OpenSSL 实现）的加解密交叉验证（正确性基准）
 * 3. 中文/emoji 内容的 UTF-8 多块加密
 */
import {captchaAesEncrypt} from '../../../src/renderers/Form/CaptchaAes';

const crypto = require('crypto');

/**
 * 用 Node crypto 按 AES-128-ECB-PKCS7 加密（基准实现）。
 * @param {string} plain 明文
 * @param {string} key 16 位密钥
 * @returns {string} base64 密文
 */
function nodeEncrypt(plain: string, key: string): string {
  const c = crypto.createCipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  return Buffer.concat([c.update(Buffer.from(plain, 'utf8')), c.final()]).toString(
    'base64'
  );
}

/**
 * 用 Node crypto 按 AES-128-ECB-PKCS7 解密（基准实现）。
 * @param {string} b64 密文 base64
 * @param {string} key 16 位密钥
 * @returns {string} 明文
 */
function nodeDecrypt(b64: string, key: string): string {
  const d = crypto.createDecipheriv('aes-128-ecb', Buffer.from(key, 'utf8'), null);
  return Buffer.concat([d.update(Buffer.from(b64, 'base64')), d.final()]).toString(
    'utf8'
  );
}

test('CaptchaAes:PKCS7 边界与非法 key', () => {
  const key = 'XwKsGlMcdPMEhR1B';
  // 恰 16 字节（单块）→ 补一整块 16 字节填充，密文 32 字节
  const exactly16 = captchaAesEncrypt('0123456789abcdef', key);
  expect(Buffer.from(exactly16, 'base64').length).toBe(32);
  // 与 OpenSSL 基准一致
  expect(exactly16).toBe(nodeEncrypt('0123456789abcdef', key));
  // 15 字节 → 16 字节密文
  expect(
    Buffer.from(captchaAesEncrypt('0123456789abcde', key), 'base64').length
  ).toBe(16);
  // key 非 16 位必须抛错（协议 key 恒为 16 位）
  expect(() => captchaAesEncrypt('abc', 'short')).toThrow();
});

test('CaptchaAes:与 Node crypto 交叉验证', () => {
  const key = 'XwKsGlMcdPMEhR1B';
  const plain = JSON.stringify({x: 160, y: 5.0});
  const enc = captchaAesEncrypt(plain, key);
  expect(nodeDecrypt(enc, key)).toBe(plain);
  // 密文与 OpenSSL 基准逐字节一致
  expect(enc).toBe(nodeEncrypt(plain, key));
  // 二次校验凭证格式
  const verification = captchaAesEncrypt(`tok-1234---${plain}`, key);
  expect(nodeDecrypt(verification, key)).toBe(`tok-1234---${plain}`);
});

test('CaptchaAes:UTF-8 多块内容', () => {
  const key = 'abcdef1234567890';
  const plain = '请依次点击【验证码】😄 abcdefg'; // 含中文与 4 字节 emoji，跨多块
  const enc = captchaAesEncrypt(plain, key);
  expect(nodeDecrypt(enc, key)).toBe(plain);
  // PKCS7：密文长度为 16 的整数倍
  expect(Buffer.from(enc, 'base64').length % 16).toBe(0);
});
