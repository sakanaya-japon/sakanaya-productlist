/**
 * verify-gas.mjs — GAS 側（gas/*.gs）の回帰テスト
 *
 * Apps Script の API（Utilities / PropertiesService / SpreadsheetApp / CacheService /
 * LockService / ContentService）を最小限エミュレートし、リポジトリの .gs を
 * そのまま読み込んで動かす。Google へは一切アクセスしないので安全に何度でも回せる。
 *
 * 検証対象:
 *   gas/price-gating.gs   … トークンの発行・検証、コード管理、価格の除去
 *   gas/telegram-login.gs … initData の署名検証、chat_id の紐付け、自動ログイン
 *   gas/doGet-doPost.gs   … 上記を組み込んだ doGet / doPost の振る舞い
 *
 * 本番プロジェクト側にしかない関数（getMergedProductData / saveWebOrderToSheet /
 * registerUser_ / sendOrderToCustomerByPhone / handleMenuUpdate_）はスタブに置き換える。
 *
 * 実行: node test/verify-gas.mjs   （リポジトリのルートから）
 */
import { readFileSync } from 'node:fs';
import { createHmac } from 'node:crypto';
import vm from 'node:vm';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const BOT_TOKEN = '123456:TEST-BOT-TOKEN';

// ── Apps Script エミュレーション ───────────────────────────────
const toSigned = (buf) => Array.from(buf).map(b => b > 127 ? b - 256 : b);
const toUnsigned = (arr) => Buffer.from(arr.map(b => b < 0 ? b + 256 : b));
const b64web = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');

class Range {
  constructor(sheet, row, col, numRows = 1, numCols = 1) {
    Object.assign(this, { sheet, row, col, numRows, numCols });
  }
  getValue() { return this.sheet.cell(this.row, this.col); }
  getValues() {
    const out = [];
    for (let r = 0; r < this.numRows; r++) {
      const line = [];
      for (let c = 0; c < this.numCols; c++) line.push(this.sheet.cell(this.row + r, this.col + c));
      out.push(line);
    }
    return out;
  }
  setValue(v) { this.sheet.setCell(this.row, this.col, v); return this; }
  setNumberFormat() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.rows = []; }
  cell(r, c) { return (this.rows[r - 1] || [])[c - 1] ?? ''; }
  setCell(r, c, v) {
    while (this.rows.length < r) this.rows.push([]);
    const row = this.rows[r - 1];
    while (row.length < c) row.push('');
    row[c - 1] = v;
  }
  getDataRange() {
    const cols = Math.max(1, ...this.rows.map(r => r.length));
    return new Range(this, 1, 1, Math.max(1, this.rows.length), cols);
  }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  getLastRow() { return this.rows.length; }
  appendRow(vals) { this.rows.push([...vals]); }
  setFrozenRows() {}
}

function makeSandbox({ props = {}, sheets = {} } = {}) {
  const store = new Map(Object.entries(props));
  const cache = new Map();
  const book = { sheets: new Map(Object.entries(sheets)) };
  const calls = { sleep: 0, notify: [], menuUpdates: [] };

  const ss = {
    getSheetByName: (n) => book.sheets.get(n) || null,
    insertSheet: (n) => { const s = new Sheet(n); book.sheets.set(n, s); return s; },
  };
  const output = (s) => ({ _s: s, getContent: () => s, setMimeType() { return this; } });

  const sandbox = {
    console: { log() {}, warn() {}, error() {} },
    Logger: { log() {} },
    Utilities: {
      MacAlgorithm: { HMAC_SHA_256: 'HMAC_SHA_256' },
      computeHmacSha256Signature: (value, key) =>
        toSigned(createHmac('sha256', typeof key === 'string' ? key : toUnsigned(key))
          .update(typeof value === 'string' ? value : toUnsigned(value)).digest()),
      computeHmacSignature: (_alg, msg, key) =>
        toSigned(createHmac('sha256', typeof key === 'string' ? key : toUnsigned(key))
          .update(typeof msg === 'string' ? msg : toUnsigned(msg)).digest()),
      base64Encode: (b) => toUnsigned(b).toString('base64'),
      base64EncodeWebSafe: (v) => b64web(typeof v === 'string' ? Buffer.from(v, 'utf8') : toUnsigned(v)),
      base64DecodeWebSafe: (s) => toSigned(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      newBlob: (v) => ({
        getBytes: () => typeof v === 'string' ? toSigned(Buffer.from(v, 'utf8')) : v,
        getDataAsString: () => typeof v === 'string' ? v : toUnsigned(v).toString('utf8'),
      }),
      sleep: (ms) => { calls.sleep += ms; },
    },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => store.get(k) ?? null, setProperty: (k, v) => store.set(k, v) }) },
    CacheService: { getScriptCache: () => ({ get: (k) => cache.get(k) ?? null, put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    SpreadsheetApp: { getActive: () => ss, openById: () => ss },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: output },
    // 本番プロジェクト側にしかない関数のスタブ
    getMergedProductData: () => ({ updateDate: '2026-09-23', products: PRODUCTS() }),
    saveWebOrderToSheet: () => ({ orderNo: 'W-001', registered: true, chatId: '999', duplicated: false }),
    sendOrderToCustomerByPhone: (...a) => { calls.notify.push(a); },
    registerUser_: (_d, out) => out({ status: 'ok' }),
    handleMenuUpdate_: (u) => { calls.menuUpdates.push(u); },
    Date, JSON, Math, Number, String, Object, Array, Boolean, isNaN, parseInt, parseFloat, RegExp, Error,
  };
  vm.createContext(sandbox);
  for (const f of ['gas/price-gating.gs', 'gas/telegram-login.gs', 'gas/doGet-doPost.gs']) {
    vm.runInContext(readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  return { sandbox, store, cache, book, calls };
}

const PRODUCTS = () => ([
  { product_id: 'P1', name_jp: 'マグロ', variants: [{ variant_id: 'V1', price_usd: 25.5, price_unit: 'kg', stock: 5 }] },
  { product_id: 'P2', name_jp: 'エビ', variants: [{ variant_id: 'V2', price_usd: 8, price_unit: 'pic', stock: 3 }] },
]);

// access_codes シートを用意する（A:code B:partner C:issued D:expires E:revoked F:last_used G:tg）
function accessSheet(rows) {
  const s = new Sheet('access_codes');
  s.appendRow(['code', 'partner_name', 'issued_at', 'expires_at', 'revoked', 'last_used_at', 'telegram_chat_ids']);
  rows.forEach(r => s.appendRow(r));
  return s;
}
const FUTURE = new Date(Date.now() + 86400000 * 30);
const PAST = new Date(Date.now() - 86400000);

// Telegram の initData を組み立てる（署名も本物と同じ手順で作る）
function makeInitData(userId, { token = BOT_TOKEN, authDate = Math.floor(Date.now() / 1000), broken = false } = {}) {
  const fields = { auth_date: String(authDate), query_id: 'AAA', user: JSON.stringify({ id: userId, first_name: 'テスト' }) };
  const dcs = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  let hash = createHmac('sha256', secret).update(dcs).digest('hex');
  if (broken) hash = hash.replace(/^./, c => (c === 'a' ? 'b' : 'a'));
  return Object.entries(fields).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&') + '&hash=' + hash;
}

// ── テスト本体 ─────────────────────────────────────────────
const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '  [PASS]' : '  [FAIL]'} ${name}${detail && !cond ? ' → ' + detail : ''}`);
};
const section = (t) => console.log(`\n${t}`);

function setup(rows = [['SJ-AAAA-BBBB', 'レストランABC', new Date(), FUTURE, '', '', '']]) {
  const env = makeSandbox({
    props: { ACCESS_TOKEN_SECRET: 'dGVzdC1zZWNyZXQ=', BOT_TOKEN, WEBHOOK_SECRET: 'wh-secret' },
    sheets: { access_codes: accessSheet(rows) },
  });
  env.get = (token) => JSON.parse(env.sandbox.doGet({ parameter: token === undefined ? {} : { token } })._s);
  env.post = (body, params) => {
    const out = env.sandbox.doPost({ postData: { contents: JSON.stringify(body) }, parameter: params || {} });
    try { return JSON.parse(out.getContent()); } catch { return { _raw: out.getContent() }; }
  };
  env.anyPrice = (d) => (d.products || []).some(p => (p.variants || []).some(v => 'price_usd' in v));
  return env;
}

section('[1] doGet — 価格の出し分け');
{
  const e = setup();
  const anon = e.get();
  check('未認証では価格が含まれない', !e.anyPrice(anon));
  check('未認証では priced:false', anon.priced === false);
  check('商品名・在庫・updateDate は残る',
    anon.products[0].name_jp === 'マグロ' && anon.products[0].variants[0].stock === 5 && anon.updateDate === '2026-09-23');
  const t = e.sandbox.issueToken_('SJ-AAAA-BBBB', 'レストランABC');
  const authed = e.get(t);
  check('正しいトークンで価格が戻る', e.anyPrice(authed) && authed.products[0].variants[0].price_usd === 25.5);
  check('正しいトークンで priced:true', authed.priced === true);
  check('でたらめなトークンは通らない', !e.anyPrice(e.get('でたらめ.トークン')));
}

section('[2] トークンの改竄・期限・失効');
{
  const e = setup();
  const t = e.sandbox.issueToken_('SJ-AAAA-BBBB', 'レストランABC');
  const [payload, sig] = t.split('.');
  check('署名の差し替えは通らない', e.sandbox.verifyToken_(payload + '.AAAA') === null);
  const forged = Buffer.from(JSON.stringify({ c: 'SJ-AAAA-BBBB', e: Date.now() + 9e11, n: 'x' }), 'utf8')
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  check('ペイロードの差し替えは通らない', e.sandbox.verifyToken_(forged + '.' + sig) === null);
  check('空・不正な形式は通らない',
    e.sandbox.verifyToken_('') === null && e.sandbox.verifyToken_(null) === null && e.sandbox.verifyToken_('abc') === null);

  const revoked = setup([['SJ-AAAA-BBBB', 'レストランABC', new Date(), FUTURE, 'YES', '', '']]);
  check('失効させたコードのトークンは通らない', revoked.sandbox.verifyToken_(t) === null);
  const expired = setup([['SJ-AAAA-BBBB', 'レストランABC', new Date(), PAST, '', '', '']]);
  check('期限切れのコードのトークンは通らない', expired.sandbox.verifyToken_(t) === null);
  const gone = setup([]);
  check('削除されたコードのトークンは通らない', gone.sandbox.verifyToken_(t) === null);
}

section('[3] doPost — unlock（コード入力）');
{
  const e = setup();
  const ok = e.post({ action: 'unlock', code: 'sj-aaaa-bbbb' });
  check('小文字入力でも通る', ok.status === 'ok', JSON.stringify(ok));
  check('トークンと取引先名を返す', !!ok.token && ok.partnerName === 'レストランABC');
  check('発行トークンで価格が見える', e.anyPrice(e.get(ok.token)));
  const ng = e.post({ action: 'unlock', code: 'SJ-ZZZZ-ZZZZ' });
  check('誤ったコードは error', ng.status === 'error');
  check('失敗理由は返さない', !ng.message && !ng.reason, JSON.stringify(ng));
  check('失敗時は応答を遅らせる', e.calls.sleep >= 700, `${e.calls.sleep}ms`);
}

section('[4] Telegram 自動ログイン（tg_login）');
{
  const e = setup([['SJ-AAAA-BBBB', 'レストランABC', new Date(), FUTURE, '', '', '555001']]);
  const ok = e.post({ action: 'tg_login', initData: makeInitData(555001) });
  check('紐付け済みの人はコード無しで通る', ok.status === 'ok', JSON.stringify(ok));
  check('トークンで価格が見える', e.anyPrice(e.get(ok.token)));
  check('取引先名を返す', ok.partnerName === 'レストランABC');

  check('未紐付けは unlinked', e.post({ action: 'tg_login', initData: makeInitData(999999) }).status === 'unlinked');
  check('署名が違えば error', e.post({ action: 'tg_login', initData: makeInitData(555001, { broken: true }) }).status === 'error');
  check('別のBotトークンの署名は error',
    e.post({ action: 'tg_login', initData: makeInitData(555001, { token: 'other:TOKEN' }) }).status === 'error');
  check('24時間より古い initData は error',
    e.post({ action: 'tg_login', initData: makeInitData(555001, { authDate: Math.floor(Date.now() / 1000) - 90000 }) }).status === 'error');
  check('未来の日時の initData は error',
    e.post({ action: 'tg_login', initData: makeInitData(555001, { authDate: Math.floor(Date.now() / 1000) + 600 }) }).status === 'error');
  check('initData 無しは error', e.post({ action: 'tg_login' }).status === 'error');

  const revoked = setup([['SJ-AAAA-BBBB', 'レストランABC', new Date(), FUTURE, 'YES', '', '555001']]);
  check('失効コードに紐付いていても通らない',
    revoked.post({ action: 'tg_login', initData: makeInitData(555001) }).status === 'unlinked');
}

section('[5] unlock 時の Telegram 紐付け');
{
  const e = setup();
  const res = e.post({ action: 'unlock', code: 'SJ-AAAA-BBBB', initData: makeInitData(777001) });
  check('unlock は成功する', res.status === 'ok');
  const g = e.book.sheets.get('access_codes').cell(2, 7);
  check('chat_id が G列に書かれる', String(g) === '777001', String(g));
  e.post({ action: 'unlock', code: 'SJ-AAAA-BBBB', initData: makeInitData(777002) });
  check('2人目も追記される（カンマ区切り）', String(e.book.sheets.get('access_codes').cell(2, 7)) === '777001,777002');
  e.post({ action: 'unlock', code: 'SJ-AAAA-BBBB', initData: makeInitData(777001) });
  check('同じ人は重複しない', String(e.book.sheets.get('access_codes').cell(2, 7)) === '777001,777002');
  check('紐付け後は自動ログインできる', e.post({ action: 'tg_login', initData: makeInitData(777002) }).status === 'ok');

  const e2 = setup();
  const bad = e2.post({ action: 'unlock', code: 'SJ-AAAA-BBBB', initData: makeInitData(777003, { broken: true }) });
  check('署名が不正なら紐付けない（ログインは成功）',
    bad.status === 'ok' && String(e2.book.sheets.get('access_codes').cell(2, 7)) === '');
}

section('[6] Telegram Webhook の合言葉');
{
  const e = setup();
  const noSecret = e.post({ update_id: 1, message: {} });
  check('合言葉なしの update は拒否', noSecret._raw === 'ng', JSON.stringify(noSecret));
  check('拒否時はハンドラを呼ばない', e.calls.menuUpdates.length === 0);
  const withSecret = e.post({ update_id: 2, message: {} }, { wh: 'wh-secret' });
  check('合言葉が合えば受け付ける', withSecret._raw === 'ok');
  check('ハンドラが呼ばれる', e.calls.menuUpdates.length === 1);
  const wrong = e.post({ update_id: 3, message: {} }, { wh: 'wrong' });
  check('合言葉が違えば拒否', wrong._raw === 'ng' && e.calls.menuUpdates.length === 1);
}

section('[7] 既存の注文機能が壊れていないこと');
{
  const e = setup();
  const o = e.post({ action: 'send_order', phone: '012345678', orderData: 'x', clientOrderId: 'c1' });
  check('send_order は status:ok', o.status === 'ok');
  check('orderNo と registered を返す', o.orderNo === 'W-001' && o.registered === true);
  check('通知が呼ばれる（chat_id 付き）', e.calls.notify.length === 1 && e.calls.notify[0][3] === '999');
  check('register_user は通る', e.post({ action: 'register_user', phone: '012' }).status === 'ok');
  check('未知のアクションは Invalid action', e.post({ action: 'nope' }).message === 'Invalid action');
  const broken = e.sandbox.doPost({ postData: { contents: '{' }, parameter: {} });
  check('壊れたJSONでも落ちない', JSON.parse(broken.getContent()).status === 'error');
}

section('[8] コードの発行・失効・価格除去');
{
  const e = setup([]);
  const code = e.sandbox.issueAccessCode('テスト商店');
  check('SJ-XXXX-XXXX 形式で発行される', /^SJ-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code), code);
  check('紛らわしい文字を含まない', !/[01OIL]/.test(code.slice(3)), code);
  check('発行直後にログインできる', e.post({ action: 'unlock', code }).status === 'ok');
  e.sandbox.revokeAccessCode(code);
  check('失効させるとログインできない', e.post({ action: 'unlock', code }).status === 'error');

  const src = [{ product_id: 'P1', name_jp: 'マグロ', variants: [{ variant_id: 'V1', price_usd: 25.5, stock: 5, price_unit: 'kg' }] }];
  const out = e.sandbox.stripPrices_(src);
  check('price_usd だけが消える',
    !('price_usd' in out[0].variants[0]) && out[0].variants[0].stock === 5 && out[0].variants[0].price_unit === 'kg');
  check('元の配列を壊さない', src[0].variants[0].price_usd === 25.5);
  check('空配列・variants 無しでも落ちない',
    JSON.stringify(e.sandbox.stripPrices_([])) === '[]' && e.sandbox.stripPrices_([{ name_jp: 'x' }])[0].variants.length === 0);
}

const failed = results.filter(r => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} 件成功 ===`);
if (failed.length) { console.log('失敗:'); failed.forEach(f => console.log(' - ' + f.name)); process.exit(1); }
