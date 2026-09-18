/**
 * price-gating.gs — 卸価格を取引先だけに出すための GAS 側の追加コード（2026-09-18）
 *
 * なぜ GAS 側なのか:
 *   カタログは GitHub Pages の静的配信なので、フロント側の分岐は防御にならない。
 *   「価格をそもそも応答に含めない」ことだけが実効性のある対策になる。
 *
 * 仕組み:
 *   1. 店側が取引先ごとにコードを発行する（issueAccessCode）
 *   2. 客がカタログでコードを入力 → doPost の action='unlock' が検証しトークンを返す
 *   3. 以降カタログは ?token=... 付きで doGet を呼ぶ。検証を通ったときだけ価格つきで返す
 *
 * トークンは署名付き（HMAC-SHA256）で、シートに保存しない。検証はシート読み取りなしで済む。
 * 取消はコード行の revoked 列で行い、その判定だけ短時間キャッシュする。
 *
 * ──────────────── 導入手順 ────────────────
 * (1) スクリプトプロパティに ACCESS_TOKEN_SECRET を設定する
 *     Apps Script エディタ → 歯車（プロジェクトの設定）→ スクリプト プロパティ
 *     値は setupAccessSecret() を一度実行すると自動生成される
 *
 * (2) access_codes シートを作る（ensureAccessCodeSheet() で自動作成できる）
 *     A:code  B:partner_name  C:issued_at  D:expires_at  E:revoked  F:last_used_at
 *     スクリプトが紐づくブック（自動注文管理ソフト）に作られる。SPREADSHEET_ID は設定しないこと
 *
 * (3) 既存の doGet に2行足す（下の doGet 例を参照）
 * (4) 既存の doPost の分岐に action==='unlock' を足す（下の doPost 例を参照）
 * (5) デプロイ → 新しいバージョンとして「ウェブアプリ」を再デプロイする
 *     ※ /exec の URL は変わらない。変わった場合は script.js の GAS_URL も更新すること
 *
 * 注意: (5) のデプロイを先に済ませてから、カタログ側（script.js）を公開すること。
 *       逆順でも表示は壊れない作りにしてあるが、価格が見えたままの時間が延びる。
 */

// ============================================================
// 設定
// ============================================================
var ACCESS_SHEET_NAME = 'access_codes';
// 通常は getActive()（＝スクリプトが紐づく「自動注文管理ソフト」）で足りる。
// 別のブックに access_codes を置きたい場合だけ、スクリプトプロパティに SPREADSHEET_ID を設定する
var SPREADSHEET_ID_KEY = 'SPREADSHEET_ID';
var ACCESS_SECRET_KEY = 'ACCESS_TOKEN_SECRET';
var TOKEN_TTL_DAYS = 90;   // トークンの有効期間。切れたらカタログが再ログインを促す
var CODE_TTL_DAYS = 365;   // 発行するコードの既定の有効期間
// 紛らわしい文字（0/O/1/I/L）を除いた英数字。口頭やチャットで伝えても取り違えにくい
var CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

// ============================================================
// スプレッドシートの解決
// ============================================================

/**
 * access_codes を置くスプレッドシートを返す。
 * 既定はスクリプトが紐づくブック（自動注文管理ソフト）。
 * 別のブックに置きたい場合だけ、スクリプトプロパティ SPREADSHEET_ID で上書きする。
 */
function getBook_() {
  var id = PropertiesService.getScriptProperties().getProperty(SPREADSHEET_ID_KEY);
  if (id) return SpreadsheetApp.openById(id);
  var active = SpreadsheetApp.getActive();
  if (active) return active;
  throw new Error(
    'スプレッドシートを特定できません。このスクリプトが商品マスターに紐づいていない場合は、' +
    'スクリプトプロパティ ' + SPREADSHEET_ID_KEY + ' に商品マスターのIDを設定してください。');
}

// ============================================================
// 初期セットアップ（エディタから1回だけ実行する）
// ============================================================

/** HMAC 用の秘密鍵を生成してスクリプトプロパティに保存する。既にあれば何もしない */
function setupAccessSecret() {
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty(ACCESS_SECRET_KEY)) {
    Logger.log('既に設定済みです。作り直すと発行済みトークンが全て無効になります。');
    return;
  }
  var bytes = [];
  for (var i = 0; i < 32; i++) bytes.push(Math.floor(Math.random() * 256) - 128);
  props.setProperty(ACCESS_SECRET_KEY, Utilities.base64Encode(bytes));
  Logger.log('ACCESS_TOKEN_SECRET を生成しました。');
}

/** access_codes シートが無ければ見出し付きで作る */
function ensureAccessCodeSheet() {
  var ss = getBook_();
  var sh = ss.getSheetByName(ACCESS_SHEET_NAME);
  if (sh) return sh;
  sh = ss.insertSheet(ACCESS_SHEET_NAME);
  sh.appendRow(['code', 'partner_name', 'issued_at', 'expires_at', 'revoked', 'last_used_at']);
  sh.setFrozenRows(1);
  return sh;
}

// ============================================================
// コードの発行・取消（店側の運用。エディタから実行する）
// ============================================================

/**
 * 取引先コードを発行する。エディタの実行ログに表示されるコードを Telegram で先方へ伝える。
 * 例: issueAccessCode('レストランABC') / issueAccessCode('ホテルXYZ', 180)
 */
function issueAccessCode(partnerName, validDays) {
  if (!partnerName) throw new Error('partnerName（取引先の表示名）を指定してください。');
  var sh = ensureAccessCodeSheet();
  var now = new Date();
  var exp = new Date(now.getTime() + (validDays || CODE_TTL_DAYS) * 86400000);
  var code = generateAccessCode_();
  sh.appendRow([code, partnerName, now, exp, '', '']);
  Logger.log('発行しました: ' + code + '（' + partnerName + ' / 期限 ' + exp.toLocaleDateString() + '）');
  return code;
}

/** コードを失効させる。以降そのコードでのログインも、発行済みトークンも通らなくなる */
function revokeAccessCode(code) {
  var sh = ensureAccessCodeSheet();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toUpperCase() === String(code).trim().toUpperCase()) {
      sh.getRange(i + 1, 5).setValue('YES');
      CacheService.getScriptCache().remove('code_' + String(code).trim().toUpperCase());
      Logger.log('失効させました: ' + code);
      return true;
    }
  }
  Logger.log('見つかりませんでした: ' + code);
  return false;
}

/** SJ-XXXX-XXXX 形式のコードを作る（32文字の英数字から8文字＝約1.1兆通り） */
function generateAccessCode_() {
  var out = '';
  for (var i = 0; i < 8; i++) {
    out += CODE_ALPHABET.charAt(Math.floor(Math.random() * CODE_ALPHABET.length));
    if (i === 3) out += '-';
  }
  return 'SJ-' + out;
}

// ============================================================
// トークンの発行と検証
// ============================================================

function getAccessSecret_() {
  var secret = PropertiesService.getScriptProperties().getProperty(ACCESS_SECRET_KEY);
  if (!secret) throw new Error('ACCESS_TOKEN_SECRET が未設定です。setupAccessSecret() を実行してください。');
  return secret;
}

function signPayload_(payload) {
  var sig = Utilities.computeHmacSha256Signature(payload, getAccessSecret_());
  return Utilities.base64EncodeWebSafe(sig).replace(/=+$/, '');
}

/** トークン = base64url({"c":コード,"e":失効時刻}) + "." + 署名
 *  ペイロードのパディング（=）は落とさない。base64DecodeWebSafe に確実に戻せる形を保つため。
 *  URL に載せる際はカタログ側が encodeURIComponent するので = があっても問題ない。 */
function issueToken_(code, partnerName) {
  var payloadObj = { c: code, e: Date.now() + TOKEN_TTL_DAYS * 86400000, n: partnerName || '' };
  var payload = Utilities.base64EncodeWebSafe(JSON.stringify(payloadObj));
  return payload + '.' + signPayload_(payload);
}

/**
 * トークンを検証する。通れば {code, partnerName} を、駄目なら null を返す。
 * 署名・有効期限を見たうえで、コード自体が取消されていないかも確認する。
 */
function verifyToken_(token) {
  if (!token || typeof token !== 'string') return null;
  var parts = token.split('.');
  if (parts.length !== 2) return null;
  if (!constantTimeEquals_(signPayload_(parts[0]), parts[1])) return null;
  var payload;
  try {
    payload = JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString());
  } catch (err) {
    return null;
  }
  if (!payload || !payload.c) return null;
  if (!payload.e || Date.now() > Number(payload.e)) return null; // 期限切れ
  if (!isCodeActive_(payload.c)) return null;                    // 取消済み
  return { code: payload.c, partnerName: payload.n || '' };
}

/** 長さと内容を最後まで見てから比較する（比較時間から答えを絞られないようにする） */
function constantTimeEquals_(a, b) {
  a = String(a); b = String(b);
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= (a.charCodeAt(i) ^ b.charCodeAt(i));
  return diff === 0;
}

/** コードが access_codes に存在し、取消されておらず、期限内か。判定は5分キャッシュする */
function isCodeActive_(code) {
  var key = 'code_' + String(code).trim().toUpperCase();
  var cache = CacheService.getScriptCache();
  var hit = cache.get(key);
  if (hit !== null) return hit === '1';
  var row = findCodeRow_(code);
  var ok = !!(row && !row.revoked && (!row.expiresAt || row.expiresAt.getTime() > Date.now()));
  cache.put(key, ok ? '1' : '0', 300);
  return ok;
}

/** access_codes からコード行を探す。無ければ null */
function findCodeRow_(code) {
  var sh = getBook_().getSheetByName(ACCESS_SHEET_NAME);
  if (!sh) return null;
  var target = String(code).trim().toUpperCase();
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]).trim().toUpperCase() !== target) continue;
    var exp = values[i][3];
    return {
      rowIndex: i + 1,
      code: String(values[i][0]).trim(),
      partnerName: String(values[i][1] || ''),
      expiresAt: (exp instanceof Date) ? exp : (exp ? new Date(exp) : null),
      revoked: String(values[i][4] || '').trim() !== ''
    };
  }
  return null;
}

// ============================================================
// 価格の取り外し
// ============================================================

/**
 * 商品配列から価格を落として返す（元の配列は書き換えない）。
 * 商品名・写真・在庫はそのまま残し、価格だけを未認証の相手に見せない。
 */
function stripPrices_(products) {
  return (products || []).map(function (p) {
    var copy = {};
    for (var k in p) if (p.hasOwnProperty(k)) copy[k] = p[k];
    copy.variants = (p.variants || []).map(function (v) {
      var vc = {};
      for (var vk in v) if (v.hasOwnProperty(vk)) vc[vk] = v[vk];
      delete vc.price_usd; // ここが本体。応答に価格を含めない
      return vc;
    });
    return copy;
  });
}

// ============================================================
// 既存の doGet / doPost への差し込み方
// ============================================================

/**
 * 差し込み済みの完成版を gas/doGet-doPost.gs に用意してある。
 * 既存プロジェクトの「2. 外部連携（doGet / doPost）」を、そのファイルの内容で置き換えること。
 *
 * 変更点は3箇所だけで、send_order / register_user の処理と応答は変えていない:
 *   1. doGet  … const access = verifyToken_(e && e.parameter ? e.parameter.token : '');
 *                if (!access && Array.isArray(data.products)) data.products = stripPrices_(data.products);
 *   2. doGet  … data.priced = !!access;
 *   3. doPost … if (data.action === "unlock") return handleUnlock_(data);
 */

/** action='unlock' の本体。コードを確認し、通ればトークンを返す */
function handleUnlock_(body) {
  var code = String((body && body.code) || '').trim().toUpperCase();
  var json = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };
  if (!code) return json({ status: 'error' });

  var row = findCodeRow_(code);
  var ok = !!(row && !row.revoked && (!row.expiresAt || row.expiresAt.getTime() > Date.now()));
  if (!ok) {
    // 失敗の理由は返さない（存在しないのか失効なのかを教えない）。
    // 総当たり対策の中心はコードの桁数（約1.1兆通り）。GAS では接続元IPが取れず
    // IP単位の制限ができないため、ここでは応答を少し遅らせるにとどめる。
    Utilities.sleep(700);
    return json({ status: 'error' });
  }

  // 最終利用日を記録しておく（使われていないコードの棚卸しに使う）
  try {
    getBook_().getSheetByName(ACCESS_SHEET_NAME).getRange(row.rowIndex, 6).setValue(new Date());
  } catch (err) {}

  return json({
    status: 'ok',
    token: issueToken_(row.code, row.partnerName),
    partnerName: row.partnerName
  });
}
