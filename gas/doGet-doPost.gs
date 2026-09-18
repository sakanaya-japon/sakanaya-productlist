/**
 * doGet-doPost.gs — 既存の「2. 外部連携（doGet / doPost）」の差し替え版（2026-09-18）
 *
 * 置き場所: 自動注文管理ソフト の Apps Script
 *   https://docs.google.com/spreadsheets/d/1RGMOTrXvtw5dIF2WkoAk7lv12MJR8o0ritOh9NAGQvA/edit
 *
 * 使い方:
 *   既存プロジェクトの doGet と doPost を、このファイルの内容でまるごと置き換える。
 *   price-gating.gs を同じプロジェクトに追加しておくこと（verifyToken_ / stripPrices_ /
 *   handleUnlock_ をここから呼んでいる）。
 *
 * 既存コードからの変更点は3箇所だけ:
 *   1. doGet  … トークンを検証し、通らなければ価格を落とす（4行）
 *   2. doGet  … 応答に priced を足す（1行）
 *   3. doPost … action==='unlock' の分岐を足す（3行）
 *   send_order / register_user の処理と応答は一切変えていない。
 *
 * 検証済み（Apps Script API をエミュレートして25項目）:
 *   未認証で価格が落ちること／不正・失効トークンが弾かれること／正しいトークンで
 *   価格が戻ること／既存の send_order・register_user・エラー処理が壊れていないこと。
 */

// ==========================================
// 2. 外部連携（doGet / doPost）
// ==========================================

function doGet(e) {
  try {
    const data = getMergedProductData();

    // ── 取引先ログインによる価格の出し分け（2026-09-18・price-gating.gs）──
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
    // 1. Webサイトからの注文送信（拒否しない導線・設計§1-2/§5）
    //    saveWebOrderToSheet が Lock→冪等→registered判定→store_name逆引き→
    //    W採番→append→Cache保存 を内部で不可分に実施し、結果を返す。
    // ═══════════════════════════════════════════════
    if (data.action === "send_order") {
      const result = saveWebOrderToSheet(data);

      // 通知は Lock 外で送信。冪等ヒット（再送）時は二重通知しない。
      if (!result.duplicated) {
        if (result.registered) {
          // 登録済み：顧客Telegram確認＋社内グループ通知
          sendOrderToCustomerByPhone(data.phone, data, result.orderNo);
        } else {
          // 未登録：社内グループへ⚠️未登録通知（要フォロー・デザイン§3-6）
          sendUnregisteredOrderAlert_(result.orderNo, data);
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
    // 3. 取引先ログイン（価格の出し分け・2026-09-18・price-gating.gs）
    //    access_codes と照合し、通れば署名付きトークンを返す。
    //    失敗理由は返さない（存在しないのか失効なのかを教えない）。
    // ═══════════════════════════════════════════════
    if (data.action === "unlock") {
      return handleUnlock_(data);
    }

    return output({ status: "error", message: "Invalid action" });

  } catch (err) {
    return output({ status: "error", message: err.message });
  }
}
