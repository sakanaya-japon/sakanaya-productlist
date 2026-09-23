/**
 * verify-catalog.mjs — カタログ画面（index.html / script.js / style.css）の回帰テスト
 *
 * 実ブラウザ（Chromium）でページを開き、GAS への通信だけを差し替えて
 * 価格の出し分け・取引先ログイン・Telegram 自動ログインの見え方を確認する。
 * 本番の GAS には一切アクセスしない。
 *
 * 実行: node test/verify-catalog.mjs   （リポジトリのルートから）
 * 必要: playwright（ローカル or グローバル導入。未導入ならその旨を表示して終了する）
 */
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const require = createRequire(import.meta.url);

function loadPlaywright() {
  try { return require('playwright'); } catch {}
  try {
    const globalRoot = execSync('npm root -g', { encoding: 'utf8' }).trim();
    return require(path.join(globalRoot, 'playwright'));
  } catch {}
  console.error('playwright が見つかりません。`npm i -D playwright` するか、グローバルに導入してください。');
  process.exit(2);
}
const { chromium } = loadPlaywright();

// ── 静的配信（画像は使わないので必要なファイルだけ返す） ──────────
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' };
const server = createServer(async (req, res) => {
  const rel = decodeURIComponent(req.url.split('?')[0].split('#')[0]).replace(/^\/+/, '') || 'index.html';
  if (rel.includes('..')) { res.writeHead(400).end(); return; }
  try {
    const body = await readFile(path.join(ROOT, rel));
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(rel)] || 'application/octet-stream' }).end(body);
  } catch { res.writeHead(404).end(); }
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/index.html`;

// ── モックデータ ────────────────────────────────────────────
const PRODUCTS = [
  { product_id: 'P1', code: 'BC210', name_jp: '本マグロ', name_en: 'Bluefin Tuna', country: 'JAPAN', size: '1kg',
    sort_order: 1, recommend_today: 0, image_main: '',
    variants: [{ variant_id: 'V_BC210LL', variant_name_jp: '中トロ', variant_name_en: 'Chutoro',
                 price_usd: 25.5, price_unit: 'kg', stock: 5, sort_order: 1, image_variant: '' }] },
  { product_id: 'P2', code: 'KH100', name_jp: 'エビ', name_en: 'Shrimp', country: 'CAMBODIA', size: 'M',
    sort_order: 2, recommend_today: 0, image_main: '',
    variants: [{ variant_id: 'V_KH100M', variant_name_jp: 'Mサイズ', variant_name_en: 'Size M',
                 price_usd: 8, price_unit: 'pic', stock: 3, sort_order: 1, image_variant: '' }] },
];
const stripped = () => PRODUCTS.map(p => ({ ...p, variants: p.variants.map(({ price_usd, ...v }) => v) }));
const GOOD_CODE = 'SJ-GOOD-CODE';
const TOKEN = 'valid-token';

const results = [];
const check = (name, cond, detail = '') => {
  results.push({ name, ok: !!cond });
  console.log(`${cond ? '  [PASS]' : '  [FAIL]'} ${name}${detail && !cond ? ' → ' + detail : ''}`);
};
const section = (t) => console.log(`\n${t}`);

const browser = await chromium.launch();

/**
 * mode: 'new'（トークン検証あり）/ 'old'（priced を返さない旧GAS）
 * tgLinked: Telegram 自動ログインを通すか
 */
async function open({ mode = 'new', tgLinked = false, hash = '', calls = [] } = {}) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  // Telegram の SDK は読み込ませない（script.js は onerror でも必ず先へ進む）
  await page.route('**://telegram.org/**', r => r.abort());
  await page.route('**://script.google.com/**', async (route) => {
    const req = route.request();
    const json = (o) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(o) });
    if (req.method() === 'POST') {
      const body = JSON.parse(req.postData() || '{}');
      calls.push(body);
      if (body.action === 'unlock') {
        return body.code === GOOD_CODE
          ? json({ status: 'ok', token: TOKEN, partnerName: 'レストランABC' })
          : json({ status: 'error' });
      }
      if (body.action === 'tg_login') {
        return tgLinked
          ? json({ status: 'ok', token: TOKEN, partnerName: 'テレグラム商店' })
          : json({ status: 'unlinked' });
      }
      return json({ status: 'ok' });
    }
    if (mode === 'old') return json({ products: PRODUCTS, updateDate: '2026-09-23' });
    const authed = new URL(req.url()).searchParams.get('token') === TOKEN;
    return json({ products: authed ? PRODUCTS : stripped(), updateDate: '2026-09-23', priced: authed });
  });
  await page.goto(BASE + hash);
  await page.waitForSelector('.variant-select-btn');
  return { ctx, page, calls };
}

const prices = (page) => page.$$eval('.variant-select-btn', els => els.map(e => e.textContent.trim()));
const hasPrice = async (page) => (await prices(page)).some(t => t.includes('$'));
const exportVisible = (page) => page.$eval('#export-area', el => el.classList.contains('is-visible'));
const accessLabel = (page) => page.$eval('#access-btn', el => el.textContent.trim());

section('[1] 通常ブラウザ・未認証');
{
  const { ctx, page } = await open();
  const t = await prices(page);
  check('価格が表示されない', !t.some(x => x.includes('$')), t.join(' | '));
  check('「取引先の方に表示」が出る', t.every(x => /取引先の方に表示|Partners only/.test(x)), t.join(' | '));
  check('Excel出力ボタンが隠れている', !(await exportVisible(page)));
  check('ヘッダーがログイン表示', /取引先ログイン|Partner login/.test(await accessLabel(page)));
  await ctx.close();
}

section('[2] 誤った取引先コード');
{
  const { ctx, page } = await open();
  await page.click('#access-btn');
  await page.fill('#unlock-code', 'SJ-WRONG-XX');
  await page.click('#unlock-btn-submit');
  await page.waitForFunction(() => document.getElementById('unlock-status-msg').textContent.includes('⚠️'));
  check('エラーが表示される', (await page.textContent('#unlock-status-msg')).includes('⚠️'));
  check('価格は出ないまま', !(await hasPrice(page)));
  await ctx.close();
}

section('[3] 正しい取引先コード');
{
  const { ctx, page } = await open();
  await page.click('#access-btn');
  await page.fill('#unlock-code', GOOD_CODE);
  await page.click('#unlock-btn-submit');
  await page.waitForFunction(() => [...document.querySelectorAll('.variant-select-btn')].some(e => e.textContent.includes('$')));
  const t = await prices(page);
  check('価格が表示される', t.some(x => x.includes('$25.50/kg')) && t.some(x => x.includes('$8.00/pic')), t.join(' | '));
  check('Excel出力ボタンが出る', await exportVisible(page));
  check('ヘッダーに取引先名が出る', (await accessLabel(page)).includes('レストランABC'), await accessLabel(page));
  check('トークンが保存される', (await page.evaluate(() => localStorage.getItem('biz_access_token'))) === TOKEN);

  await page.reload(); await page.waitForSelector('.variant-select-btn');
  check('リロード後も価格が出る', await hasPrice(page));

  await page.click('#access-btn');
  await page.waitForFunction(() => ![...document.querySelectorAll('.variant-select-btn')].some(e => e.textContent.includes('$')));
  check('ログアウトで価格が隠れる', !(await hasPrice(page)));
  check('ログアウトでExcelも隠れる', !(await exportVisible(page)));
  check('トークンが消える', !(await page.evaluate(() => localStorage.getItem('biz_access_token'))));
  await ctx.close();
}

section('[4] トークンが失効していた場合');
{
  const { ctx, page } = await open();
  await page.evaluate(() => { localStorage.setItem('biz_access_token', 'STALE'); localStorage.setItem('biz_partner_name', '古い商店'); });
  await page.reload(); await page.waitForSelector('.variant-select-btn');
  check('価格は出ない', !(await hasPrice(page)));
  check('失効したトークンを破棄する', !(await page.evaluate(() => localStorage.getItem('biz_access_token'))));
  check('再ログインの案内が入る', (await page.textContent('#unlock-status-msg')).includes('🔓'));
  await ctx.close();
}

section('[5] 旧GAS（priced を返さない）でも画面が壊れない');
{
  const { ctx, page } = await open({ mode: 'old' });
  check('価格が従来どおり出る', (await prices(page)).some(x => x.includes('$25.50/kg')));
  check('Excel出力も使える', await exportVisible(page));
  await ctx.close();
}

section('[6] 英語表示');
{
  const { ctx, page } = await open();
  await page.click('#lang-en');
  check('"Partners only" と出る', (await prices(page)).every(x => x.includes('Partners only')));
  check('ボタンも英語', (await accessLabel(page)).includes('Partner login'), await accessLabel(page));
  await ctx.close();
}

const TG_HASH = '#tgWebAppData=' + encodeURIComponent('auth_date=1&user=%7B%22id%22%3A1%7D&hash=deadbeef') + '&tgWebAppVersion=7.0';

section('[7] Telegram Mini App・紐付け済み（自動ログイン）');
{
  const calls = [];
  const { ctx, page } = await open({ tgLinked: true, hash: TG_HASH, calls });
  await page.waitForFunction(() => [...document.querySelectorAll('.variant-select-btn')].some(e => e.textContent.includes('$')), null, { timeout: 15000 });
  check('コード入力なしで価格が出る', await hasPrice(page));
  check('ヘッダーに取引先名が出る', (await accessLabel(page)).includes('テレグラム商店'), await accessLabel(page));
  check('tg_login が initData 付きで呼ばれる',
    calls.some(c => c.action === 'tg_login' && typeof c.initData === 'string' && c.initData.length > 0));
  await ctx.close();
}

section('[8] Telegram Mini App・未紐付け');
{
  const calls = [];
  const { ctx, page } = await open({ tgLinked: false, hash: TG_HASH, calls });
  check('価格は出ない', !(await hasPrice(page)));
  check('ログインボタンのまま', /取引先ログイン|Partner login/.test(await accessLabel(page)));
  check('tg_login は試している', calls.some(c => c.action === 'tg_login'));

  await page.click('#access-btn');
  await page.fill('#unlock-code', GOOD_CODE);
  await page.click('#unlock-btn-submit');
  await page.waitForFunction(() => [...document.querySelectorAll('.variant-select-btn')].some(e => e.textContent.includes('$')));
  const unlock = calls.find(c => c.action === 'unlock');
  check('unlock に initData が添えられる（紐付け用）', !!unlock && typeof unlock.initData === 'string' && unlock.initData.length > 0);
  check('コード入力後は価格が出る', await hasPrice(page));
  await ctx.close();
}

section('[9] 通常ブラウザでは Telegram 連携を呼ばない');
{
  const calls = [];
  const { ctx, page } = await open({ calls });
  check('tg_login を呼ばない', !calls.some(c => c.action === 'tg_login'));
  await ctx.close();
}

await browser.close();
server.close();

const failed = results.filter(r => !r.ok);
console.log(`\n=== ${results.length - failed.length}/${results.length} 件成功 ===`);
if (failed.length) { console.log('失敗:'); failed.forEach(f => console.log(' - ' + f.name)); process.exit(1); }
