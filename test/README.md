# 回帰テスト

取引先ログイン（価格の出し分け）と Telegram 自動ログインが壊れていないかを確認する。
**本番の GAS・スプレッドシート・Telegram には一切アクセスしない**ので、いつでも何度でも実行できる。

```bash
node test/verify-gas.mjs        # GAS側（gas/*.gs）— 52項目
node test/verify-catalog.mjs    # カタログ画面（index.html / script.js）— 30項目
```

## なぜ必要か

価格の出し分け（`price-gating.gs`）と Telegram 自動ログイン（`telegram-login.gs`）は、
トークンの発行・検証（`issueToken_` / `verifyToken_`）と `access_codes` シートを共有している。
片方を直したときにもう片方が静かに壊れうるため、変更後はこの2本を通してから本番へ出す。

**特に注意**: `stripPrices_` や `verifyToken_` の挙動が変わると、卸価格が未認証の相手に
出てしまう。これは画面を見ても気づきにくいので、テストで押さえている。

## verify-gas.mjs

Apps Script の API（`Utilities` / `PropertiesService` / `SpreadsheetApp` / `CacheService` /
`LockService` / `ContentService`）をエミュレートし、`gas/` の .gs をそのまま読み込んで動かす。
本番プロジェクト側にしかない関数（`getMergedProductData` / `saveWebOrderToSheet` /
`registerUser_` / `sendOrderToCustomerByPhone` / `handleMenuUpdate_`）はスタブに差し替える。

見ているもの: 価格の出し分け／トークンの改竄・期限・失効／unlock／Telegram の initData 署名検証／
chat_id の紐付け／Webhook の合言葉／既存の注文機能が壊れていないこと／コードの発行と失効。

Telegram の `initData` はテスト内で本物と同じ手順（`HMAC(key="WebAppData", msg=botToken)` →
`HMAC(key=secret, msg=data_check_string)`）で署名を作っているので、検証ロジックを素通りさせていない。

## verify-catalog.mjs

Chromium で実際にページを開き、`script.google.com` への通信だけを差し替える。
Telegram Mini App は URL の `#tgWebAppData=...` で再現する。

見ているもの: 未認証で価格が隠れること／誤ったコードが弾かれること／正しいコードで価格が出ること／
リロードで維持されること／ログアウト／トークン失効時の破棄／旧GAS（`priced` を返さない）でも
画面が壊れないこと／英語表示／Telegram 自動ログイン（紐付け済み・未紐付け）。

playwright が必要。ローカル（`npm i -D playwright`）でもグローバル導入でも動く。

## 注意

- `gas/TelegramMenu.gs` は本リポジトリに未収録のため、`handleMenuUpdate_` はスタブで代用している。
  取り込んだら、Webhook まわりのテストを実物に差し替えること。
- 本番プロジェクト側の関数をスタブにしている以上、**注文処理そのものの正しさは見ていない**。
  見ているのは「価格の出し分けを足したことで既存の分岐が壊れていないか」まで。
