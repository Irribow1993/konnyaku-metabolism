/* =========================================================================
 * METABOLISM — savecode.js（v0.1.2）
 * セーブの書き出し・読み込み用の文字列。通信は使わない（コピー＆貼り付けで端末・ブラウザ・住所をまたぐ）。
 *
 *  形式：METABOLISM1:<Sim.serialize() の JSON を UTF-8 → Base64>:<CRC-32（16進8桁）>
 *  CRC-32 は写し間違い・貼り付けの欠けを見つけるためのもの。改ざんを防ぐものではない（一人用のゲームなので防がない）。
 *  中身の確かめ（項目・型・範囲・__proto__ などのキー）は Sim.deserialize()、値どうしのつじつまは Sim.checkIntegrity() が行う。
 * ========================================================================= */
(function (root) {
  'use strict';
  const MB = root.MB, S = MB.Sim;
  const PREFIX = 'METABOLISM1:';
  const MAX_CHARS = 200000;            // 貼り付けを受け付ける最大の長さ（ふつうのセーブは数 KB）

  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  function crc32(str) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < str.length; i++) c = CRC_TABLE[(c ^ str.charCodeAt(i)) & 0xFF] ^ (c >>> 8);
    return ((c ^ 0xFFFFFFFF) >>> 0).toString(16).padStart(8, '0');
  }
  function toBase64(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function fromBase64(b64) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  }

  /* 今の state を書き出す（serialize は lastSaved を今の時刻にする） */
  function encode(state) {
    const b64 = toBase64(S.serialize(state));
    return PREFIX + b64 + ':' + crc32(b64);
  }

  /* 貼り付けられた文字列を読む。返り値 { ok: true, state } または { ok: false, error: '画面に出す文' } */
  function decode(text) {
    const fail = (error, problems) => ({ ok: false, error, problems: problems || [] });
    if (typeof text !== 'string') return fail('文字列が読み取れませんでした。');
    if (text.length > MAX_CHARS) return fail('文字列が長すぎます。書き出した文字列だけを貼り付けてください。');
    const code = text.replace(/\s+/g, '');               // 前後・途中の空白と改行は無視する（メールなどで折り返されても読めるように）
    if (!code) return fail('文字列が空です。書き出した文字列を貼り付けてください。');
    if (!code.startsWith(PREFIX)) return fail('METABOLISM のセーブの文字列ではないようです（先頭が「METABOLISM1:」ではありません）。');
    const body = code.slice(PREFIX.length), cut = body.lastIndexOf(':');
    if (cut < 0) return fail('文字列の終わりが欠けているようです。最後まで貼り付けてください。');
    const b64 = body.slice(0, cut), sum = body.slice(cut + 1).toLowerCase();
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(b64) || !/^[0-9a-f]{8}$/.test(sum)) return fail('文字列に使えない文字が入っているか、一部が欠けています。');
    if (crc32(b64) !== sum) return fail('文字列が途中で変わっているか、欠けています（確認用の数字が合いません）。もう一度、書き出した文字列をそのまま貼り付けてください。');
    let json;
    try { json = fromBase64(b64); } catch (e) { return fail('文字列の中身を読み取れませんでした。'); }
    let raw;
    try { raw = JSON.parse(json); } catch (e) { return fail('セーブの中身が壊れています。'); }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('セーブの中身が壊れています。');
    const v = raw.saveVersion;
    if (!Number.isInteger(v) || v < 1) return fail('セーブの版が読み取れません。');
    if (v > S.SAVE_VERSION) return fail('新しい版の METABOLISM で書き出したセーブです。この版では読み込めません。');
    const state = S.deserialize(json);
    if (!state) return fail('セーブの中身が壊れています。');
    const bad = S.checkIntegrity(state);                  // 値どうしのつじつま（保存量・研究の Lv・時刻など）
    if (bad.length) return fail('セーブの中身の数値のつじつまが合いません（' + bad[0] + (bad.length > 1 ? `。ほか ${bad.length - 1} 件` : '') + '）。', bad);
    return { ok: true, state };
  }

  /* 確認画面に出す要約（文字だけ。HTML にはしない） */
  function summary(state) {
    const ids = [...MB.MICRO_IDS, 'ldh', 'mct'];
    const found = ids.filter(id => S.isIdentified(state, id)).length;
    return { t: state.t || 0, rp: state.rp || 0, identified: found, of: ids.length };
  }

  MB.SaveCode = { PREFIX, MAX_CHARS, encode, decode, summary, crc32 };
})(typeof window !== 'undefined' ? window : globalThis);
