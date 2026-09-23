/**
 * doGet-doPost.gs — 「2. 外部連携（doGet / doPost）」の本番同期版（2026-09-22）
 *
 * 置き場所: 自動注文管理ソフト の Apps Script（本番では IN&DN.gs の中にある）
 *   https://docs.google.com/spreadsheets/d/1RGMOTrXvtw5dIF2WkoAk7lv12MJR8o0ritOh9NAGQvA/edit
 *
 * 使い方:
 *   既存プロジェクトの doGet と doPost を、このファイルの内容でまるごと置き換える。
 *   次のファイルが同じプロジェクトにあること:
 *     price-gating.gs   … verifyToken_ / stripPrices_ / handleUnlock_
 *     telegram-login.gs … handleTgLogin_ / linkTelegramAfterUnlock_
 *     TelegramMenu.gs   … handleMenuUpdate_（法人向け常設メニュー。本リポジトリには未収録）
 *
 * 2026-09-18 版からの変更点:
 *   0. doPost … Telegram の update（Webhook）を合言葉 wh で受ける分岐を追加（TelegramMenu.gs）
 *   1. doPost … send_order の通知を登録有無で分けず、失敗しても応答を error にしない
 *   2. doPost … unlock 成功時に initData があれば Telegram アカウントをコードに紐付ける
 *   3. doPost … action==='tg_login' の分岐を追加（Telegram Mini App からの自動ログイン）
 *
 * 2026-09-23 に clasp で本番プロジェクトから取得した内容と同一。
 */

// ==========================================
// 2. 外部連携（doGet / doPost）
// ==========================================

// ★2026-09-18 取引先ログインによる価格の出し分け（price-gating.js）が本番エディタで直接追加された。
//   2026-09-22 の pull 突合でリポジトリへ取り込み（doGet の4行＋doPost の unlock 分岐）。
//   verifyToken_ / stripPrices_ / handleUnlock_ は price-gating.js に定義。
function doGet(e) {
  try {
    const data = getMergedProductData();

    // ── 取引先ログインによる価格の出し分け（2026-09-18・price-gating.js）──
    // トークンが通らなければ価格を落として返す。未認証の相手には価格をそもそも送らない。
    const access = verifyToken_(e && e.parameter ? e.parameter.token : '');
    if (!access && Array.isArray(data.products)) {
      data.products = stripPrices_(data.products);
    }
    data.priced = !!access; // カタログ側の表示判断用

    return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ error: true, message: err.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  const output = (data) => ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
  
  try {
    const raw = e.postData.contents || "{}";
    const data = JSON.parse(raw);

    
    // ═══════════════════════════════════════════════
    // 0. Telegram の update（法人向け常設メニュー・TelegramMenu.gs）
    //    /exec の URL はカタログの公開コードに載っているため、合言葉(wh)が
    //    一致するリクエストだけを Telegram からのものとして扱う。
    // ═══════════════════════════════════════════════
    if (data.update_id != null) {
      const whSecret = PropertiesService.getScriptProperties().getProperty('WEBHOOK_SECRET');
      const whGiven = (e && e.parameter) ? String(e.parameter.wh || '') : '';
      if (!whSecret || whGiven !== whSecret) {
        console.warn('不正な update を拒否しました');
        return ContentService.createTextOutput('ng'); // 理由は返さない
      }
      handleMenuUpdate_(data);
      return ContentService.createTextOutput('ok'); // Telegram には常に 200（再送ループ防止）
    }

    // ═══════════════════════════════════════════════
    // 1. Webサイトからの注文送信（拒否しない導線・設計§1-2/§5）
    //    saveWebOrderToSheet が Lock→冪等→registered判定→store_name逆引き→
    //    W採番→append→Cache保存 を内部で不可分に実施し、結果を返す。
    // ═══════════════════════════════════════════════
    if (data.action === "send_order") {
      const result = saveWebOrderToSheet(data);

      // 通知は Lock 外で送信。冪等ヒット（再送）時は二重通知しない。
      // 2026-09-22 月次締め統合：未登録（Telegram未連携）の分岐と⚠️未登録アラートを廃止。
      // 登録の有無にかかわらず同じ通知経路（顧客chat_idがあれば顧客へ＋社内グループへ）。
      // 未連携の場合は社内グループ通知に「Telegram未連携」を1行付記する（sendOrderToCustomerByPhone）。
      // 通知失敗で応答を error にしない（行は保存済み。reviewer 中-11）。chat_id は保存時の判定結果を再利用。
      if (!result.duplicated) {
        try {
          sendOrderToCustomerByPhone(data.phone, data, result.orderNo, result.chatId);
        } catch (eNotify) {
          console.error("注文通知の送信失敗（注文 " + result.orderNo + " は保存済み）: " + eNotify);
        }
      }

      // 応答は常に status:"ok"（旧フロント互換 superset・設計§3-1）。
      // status:"unregistered" は廃止。未登録は registered:false で表す。
      return output({ status: "ok", orderNo: result.orderNo, registered: result.registered });
    }

    // ═══════════════════════════════════════════════
    // 2. ユーザー登録（初めての方＝Web仮登録 / Bot＝確定マッチ）
    //    設計§1-3/§4-1：chat_id完全一致 → 電話下8桁でWEB_TEMP確定マッチ →
    //    60秒fallback（プロパティでON/OFF・§4-3） → 新規行、の順。
    //    C-2 #2（ヘッダー10列化）・C-2 #3（I列検索是正・到達不能コード除去）を統合。
    // ═══════════════════════════════════════════════
    if (data.action === "register_user") {
      return registerUser_(data, output);
    }

    // ═══════════════════════════════════════════════
    // 3. 取引先ログイン（価格の出し分け・2026-09-18・price-gating.js）
    //    access_codes と照合し、通れば署名付きトークンを返す。
    //    失敗理由は返さない（存在しないのか失効なのかを教えない）。
    // ═══════════════════════════════════════════════
    if (data.action === "unlock") {
      const unlockOut = handleUnlock_(data);
      // Telegram から開いたカタログでのログインなら、その Telegram アカウントをコードに紐付ける（telegram-login.gs）
      linkTelegramAfterUnlock_(data, unlockOut);
      return unlockOut;
    }

    // ═══════════════════════════════════════════════
    // 4. Telegram Mini App からの自動ログイン（telegram-login.gs）
    //    initData を Bot トークンで署名検証し、access_codes の G列に
    //    紐付いていれば、コード入力なしでトークンを返す。
    // ═══════════════════════════════════════════════
    if (data.action === "tg_login") {
      return handleTgLogin_(data);
    }

    return output({ status: "error", message: "Invalid action" });

  } catch (err) {
    return output({ status: "error", message: err.message });
  }
}

