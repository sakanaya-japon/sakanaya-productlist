/**
 * telegram-login.gs — Telegram Mini App からの自動ログイン（2026-09-22）
 *
 * 目的:
 *   Telegram のメニューボタン／インラインボタンからカタログを開いた取引先を、
 *   コード入力なしで「その取引先としてログイン済み」にする。
 *
 * 仕組み:
 *   1. カタログが Telegram の起動データ（initData）を action='tg_login' で送る
 *   2. GAS が Bot トークンで initData の署名を検証する（改ざん・なりすまし不可）
 *   3. 検証済みの Telegram ユーザーID を access_codes の G列 telegram_chat_ids と照合
 *   4. 紐付いたコードが有効なら、既存と同じ署名付きトークン（issueToken_）を返す
 *
 * 紐付けのされ方:
 *   - 取引先が Telegram から開いたカタログで、コードを1回だけ入力すると自動で紐付く
 *     （doPost の unlock 分岐で linkTelegramAfterUnlock_ を呼ぶ）
 *   - 取引先が Bot に /link SJ-XXXX-XXXX を送っても紐付く（TelegramMenu.gs）
 *   - スタッフが linkTelegramChatManually('SJ-XXXX-XXXX', 123456789) で紐付けることもできる
 *   - 1つのコードに複数の chat_id（同じ店の複数スタッフ）をカンマ区切りで紐付けられる
 *
 * 取消:
 *   - revokeAccessCode でコードを失効させれば、紐付いた全員の自動ログインも止まる（既存の仕組みのまま）
 *   - 特定の人だけ外す場合は unlinkTelegramChat(chatId) を実行する
 *
 * 前提:
 *   - price-gating.gs が同じプロジェクトにあること（getBook_ / findCodeRow_ / issueToken_ /
 *     constantTimeEquals_ / ensureAccessCodeSheet を使う）
 *   - スクリプトプロパティ BOT_TOKEN または MENU_BOT_TOKEN が、カタログを開く Bot のトークンであること
 */

var TG_LOGIN_MAX_AGE_SEC = 86400;          // initData の有効時間（24時間）。古い起動データの使い回しを防ぐ
var TG_CHAT_COL = 7;                        // access_codes の G列

var TG_CHAT_HEADER = 'telegram_chat_ids';
var TG_BOT_TOKEN_KEY = 'BOT_TOKEN';
var TG_MENU_BOT_TOKEN_KEY = 'MENU_BOT_TOKEN'; // 法人専用 Bot を別に立てた場合のみ設定

// ============================================================
// initData の署名検証（Telegram 公式の手順）
//   secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
//   hash       = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
//   data_check_string = hash 以外の全項目を key=value にしてキー順に並べ \n で連結
// ============================================================

/**
 * 検証に通れば {userId, firstName, username} を、駄目なら null を返す
 */
function verifyTelegramInitData_(initData) {
  if (!initData || typeof initData !== 'string' || initData.length > 4096) return null;

  // カタログを開く Bot が複数ある場合（法人専用 Bot を別に立てた場合）は、どちらのトークンでも検証できるようにする
  var props = PropertiesService.getScriptProperties();
  var tokens = [props.getProperty(TG_BOT_TOKEN_KEY), props.getProperty(TG_MENU_BOT_TOKEN_KEY)]
    .filter(function (t) { return !!t; });
  if (!tokens.length) throw new Error('スクリプトプロパティ ' + TG_BOT_TOKEN_KEY + ' が未設定です');

  var decode = function (s) { return decodeURIComponent(String(s).replace(/\+/g, '%20')); };
  var fields = {};
  var hash = '';
  var parts = initData.split('&');
  for (var i = 0; i < parts.length; i++) {
    var idx = parts[i].indexOf('=');
    if (idx <= 0) continue;
    var k, v;
    try {

      k = decode(parts[i].slice(0, idx));
      v = decode(parts[i].slice(idx + 1));
    } catch (err) {
      return null; // 不正なエンコード
    }
    if (k === 'hash') hash = v;
    else fields[k] = v;
  }
  if (!/^[0-9a-f]{64}$/.test(hash)) return null;

  var dataCheckString = Object.keys(fields).sort().map(function (key) {
    return key + '=' + fields[key];
  }).join('\n');

  // computeHmacSha256Signature(value, key) → HMAC(key='WebAppData', msg=botToken)
  var dcsBytes = Utilities.newBlob(dataCheckString).getBytes();
  var matched = false;
  for (var t = 0; t < tokens.length; t++) {
    var secretKey = Utilities.computeHmacSha256Signature(tokens[t], 'WebAppData');
    var sig = Utilities.computeHmacSignature(Utilities.MacAlgorithm.HMAC_SHA_256, dcsBytes, secretKey);
    var hex = sig.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
    if (constantTimeEquals_(hex, hash)) { matched = true; break; }
  }
  if (!matched) return null;

  var authDate = Number(fields.auth_date);
  var nowSec = Math.floor(Date.now() / 1000);
  if (!authDate || nowSec - authDate > TG_LOGIN_MAX_AGE_SEC || authDate - nowSec > 300) return null;

  var user;
  try { user = JSON.parse(fields.user || ''); } catch (err) { return null; }
  if (!user || !user.id || !/^\d+$/.test(String(user.id))) return null;


  return {
    userId: String(user.id),
    firstName: String(user.first_name || ''),
    username: String(user.username || '')
  };
}

// ============================================================
// access_codes の G列（telegram_chat_ids）
// ============================================================

/** G列の見出しが無ければ付ける */
function ensureTelegramColumn_() {
  var sh = ensureAccessCodeSheet();
  var head = sh.getRange(1, TG_CHAT_COL);
  if (String(head.getValue()).trim() === '') head.setValue(TG_CHAT_HEADER);
  return sh;
}

function parseChatIds_(cell) {
  return String(cell == null ? '' : cell)
    .split(/[,\s、，]+/)
    .map(function (s) { return s.trim(); })
    .filter(function (s) { return /^\d+$/.test(s); });
}

/** chat_id が紐付いた有効なコード行を返す。無ければ null */
function findCodeRowByChatId_(chatId) {
  var sh = getBook_().getSheetByName(ACCESS_SHEET_NAME);
  if (!sh) return null;
  var target = String(chatId);

  var values = sh.getDataRange().getValues();
  var now = Date.now();
  for (var i = 1; i < values.length; i++) {
    var r = values[i];
    if (String(r[0] || '').trim() === '') continue; // 空行・コード無し行はスキップ
    if (parseChatIds_(r[TG_CHAT_COL - 1]).indexOf(target) === -1) continue;
    var exp = r[3];
    var expiresAt = (exp instanceof Date) ? exp : (exp ? new Date(exp) : null);
    var revoked = String(r[4] || '').trim() !== '';
    if (revoked || (expiresAt && expiresAt.getTime() <= now)) continue; // 失効・期限切れは次を探す
    return {
      rowIndex: i + 1,
      code: String(r[0]).trim(),
      partnerName: String(r[1] || '')
    };
  }
  return null;
}

/** コード行に chat_id を追加する（重複は追加しない）。成功で true */
function addChatIdToCode_(code, chatId) {
  var target = String(code || '').trim().toUpperCase();
  var id = String(chatId || '').trim();
  if (!target || !/^\d+$/.test(id)) return false;

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var sh = ensureTelegramColumn_();
    var values = sh.getDataRange().getValues();
    for (var i = 1; i < values.length; i++) {
      if (String(values[i][0] || '').trim().toUpperCase() !== target) continue;

      var ids = parseChatIds_(values[i][TG_CHAT_COL - 1]);
      if (ids.indexOf(id) === -1) {
        ids.push(id);
        var cell = sh.getRange(i + 1, TG_CHAT_COL);
        cell.setNumberFormat('@'); // 数値化・指数表記を防ぐ
        cell.setValue(ids.join(','));
      }
      return true;
    }
    return false;
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// doPost から呼ぶ処理
// ============================================================

/** action='tg_login' の本体 */
function handleTgLogin_(body) {
  var json = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };

  var tg;
  try {
    tg = verifyTelegramInitData_(body && body.initData);
  } catch (err) {
    console.error('handleTgLogin_', err.message);
    return json({ status: 'error' });
  }

  if (!tg) {
    Utilities.sleep(300);
    return json({ status: 'error' });
  }

  var row = findCodeRowByChatId_(tg.userId);
  if (!row) return json({ status: 'unlinked' }); // 本人確認は通ったが未紐付け → カタログは通常のログインボタンを出す

  try {
    getBook_().getSheetByName(ACCESS_SHEET_NAME).getRange(row.rowIndex, 6).setValue(new Date()); // last_used_at
  } catch (err) {}

  return json({
    status: 'ok',
    token: issueToken_(row.code, row.partnerName),
    partnerName: row.partnerName
  });
}

/**
 * unlock が成功し、かつ initData が添えられていたら、その Telegram アカウントをコードに紐付ける。
 * 紐付けに失敗してもログイン自体の応答は変えない（価格表示は正常に行われる）。
 */
function linkTelegramAfterUnlock_(body, unlockOutput) {
  try {
    if (!body || !body.initData || !unlockOutput) return;
    var res = JSON.parse(unlockOutput.getContent());
    if (!res || res.status !== 'ok') return;

    var tg = verifyTelegramInitData_(body.initData);
    if (!tg) return;


    var ok = addChatIdToCode_(body.code, tg.userId);
    if (!ok) console.warn('紐付け対象のコードが見つかりません: ' + body.code);
  } catch (err) {
    console.warn('linkTelegramAfterUnlock_', err.message);
  }
}

// ============================================================
// スタッフ用（エディタから実行）
// ============================================================

/**
 * スタッフが手動で紐付ける。chat_id は Users シートや Bot のログで確認できる数字。
 * 例: linkTelegramChatManually('SJ-ABCD-EFGH', 123456789)
 */
function linkTelegramChatManually(code, chatId) {
  if (!findCodeRow_(code)) {
    Logger.log('コードが見つかりません: ' + code);
    return false;
  }
  var ok = addChatIdToCode_(code, chatId);
  Logger.log(ok ? ('紐付けました: ' + code + ' ← ' + chatId) : ('紐付けに失敗しました: ' + code));
  return ok;
}

/** 特定の chat_id の紐付けをすべてのコードから外す（担当者の退職・端末変更時など） */
function unlinkTelegramChat(chatId) {
  var id = String(chatId || '').trim();
  if (!/^\d+$/.test(id)) { Logger.log('chat_id が不正です: ' + chatId); return 0; }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);

  try {
    var sh = ensureTelegramColumn_();
    var values = sh.getDataRange().getValues();
    var count = 0;
    for (var i = 1; i < values.length; i++) {
      var ids = parseChatIds_(values[i][TG_CHAT_COL - 1]);
      var pos = ids.indexOf(id);
      if (pos === -1) continue;
      ids.splice(pos, 1);
      var cell = sh.getRange(i + 1, TG_CHAT_COL);
      cell.setNumberFormat('@');
      cell.setValue(ids.join(','));
      count++;
    }
    Logger.log(count + ' 件のコードから外しました: ' + id);
    return count;
  } finally {
    lock.releaseLock();
  }
}