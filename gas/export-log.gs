/**
 * export-log.gs — 商品リストのExcel(CSV)ダウンロード履歴（2026-11-22）
 *
 * カタログの「⬇ This view to Excel」「⬇ All items to Excel」が押されて
 * 実際にファイルが生成されたとき、カタログ側から action='log_export' が届く。
 *   1. トークンを verifyToken_（price-gating.gs）で検証し、取引先名をサーバー側で確定
 *      （クライアントが送ってくる名前は信用しない）
 *   2. 「ダウンロード履歴」シートに1行追加
 *   3. 社内グループ（TELEGRAM_CHAT_ID_GROUP）へ Telegram 通知
 *      ※同じ取引先・同じ種別の連打は60秒間通知を抑止（記録はする）
 *
 * 依存（同じプロジェクト内の既存関数）:
 *   verifyToken_ / getBook_ … price-gating.gs
 *   sendTelegramMessage / TELEGRAM_CHAT_ID_GROUP … IN&DN.gs
 *
 * doPost への追加（"Invalid action" の直前）:
 *   if (data.action === "log_export") {
 *     return handleLogExport_(data);
 *   }
 */

var EXPORT_LOG_SHEET = 'ダウンロード履歴';
var EXPORT_LOG_HEADERS = ['日時', '取引先名', '取引先コード', '種別', '件数', '言語', 'カテゴリ', 'UserAgent'];
var EXPORT_LOG_SCOPES = { current: '表示中 (This view)', all: '全商品 (All items)' };
var EXPORT_NOTIFY_COOLDOWN_SEC = 60;

function handleLogExport_(data) {
  var json = function (obj) {
    return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
  };

  // 種別はホワイトリストで検証
  var scope = String((data && data.scope) || '');
  if (!EXPORT_LOG_SCOPES.hasOwnProperty(scope)) return json({ status: 'error', message: 'invalid' });

  // 認証済みの取引先だけ記録（/exec URL は公開されているため、無認証の送信で通知を荒らされないように）
  var access = verifyToken_(data.token);
  if (!access) return json({ status: 'error', message: 'unauthorized' });

  var now = new Date();
  var row = [
    Utilities.formatDate(now, 'GMT+7', 'yyyy/MM/dd HH:mm:ss'),
    exportLogCell_(access.partnerName, 80) || '(名称未設定)',
    exportLogCell_(access.code, 40),
    EXPORT_LOG_SCOPES[scope],
    exportLogCount_(data.count),
    exportLogCell_(data.lang, 10),
    exportLogCell_(data.category, 40),
    exportLogCell_(data.ua, 200)
  ];

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
    var sh = ensureExportLogSheet_();
    sh.appendRow(row);
  } catch (err) {
    console.error('ダウンロード履歴の記録失敗: ' + err);
    return json({ status: 'error', message: 'log failed' });
  } finally {
    try { lock.releaseLock(); } catch (e) {}
  }

  // 通知（Lock 外）。失敗しても記録は成功扱い
  try {
    var cache = CacheService.getScriptCache();
    var key = 'explog_' + Utilities.base64EncodeWebSafe(String(access.code) + '|' + scope).slice(0, 200);
    if (!cache.get(key)) {
      cache.put(key, '1', EXPORT_NOTIFY_COOLDOWN_SEC);
      if (TELEGRAM_CHAT_ID_GROUP) {
        var msg = '📥 商品リストDL\n'
          + '取引先: ' + row[1] + '\n'
          + '種別: ' + row[3] + (row[4] !== '' ? '（' + row[4] + '件）' : '') + '\n'
          + (row[6] ? 'カテゴリ: ' + row[6] + '\n' : '')
          + '日時: ' + row[0];
        sendTelegramMessage(TELEGRAM_CHAT_ID_GROUP, msg);
      }
    }
  } catch (eNotify) {
    console.error('ダウンロード通知の送信失敗（記録は済み）: ' + eNotify);
  }

  return json({ status: 'ok' });
}

/** 「ダウンロード履歴」シートを用意（なければ作成） */
function ensureExportLogSheet_() {
  var ss = getBook_();
  var sh = ss.getSheetByName(EXPORT_LOG_SHEET);
  if (!sh) {
    sh = ss.insertSheet(EXPORT_LOG_SHEET);
    sh.getRange(1, 1, 1, EXPORT_LOG_HEADERS.length).setValues([EXPORT_LOG_HEADERS]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

/** セル値の無害化：改行除去・長さ制限・数式インジェクション対策 */
function exportLogCell_(v, maxLen) {
  var s = String(v == null ? '' : v).replace(/[\r\n\t]+/g, ' ').trim().slice(0, maxLen);
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/** 件数は 0〜100000 の整数のみ受け付ける */
function exportLogCount_(v) {
  var n = Number(v);
  return (isFinite(n) && n >= 0 && n <= 100000) ? Math.floor(n) : '';
}

/** 手動実行用：シートだけ先に作っておく */
function setupExportLogSheet() {
  ensureExportLogSheet_();
  console.log('「' + EXPORT_LOG_SHEET + '」シートを用意しました');
}
