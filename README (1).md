# SAKANAYA JAPON — 法人向け商品カタログ（PRODUCT LIST）

カンボジア・プノンペンの魚屋 SAKANAYA JAPON の、法人（レストラン・ホテル等）向け商品カタログ兼・注文受付サイトです。
GitHub Pages で公開しています。

**公開URL:** https://sakanaya-japon.github.io/sakanaya-productlist/

- 個人向けサイトは別リポジトリ: https://github.com/sakanaya-japon/sakanayajapon
- 商品データ（商品名・価格・在庫）はこのリポジトリには入っていません。スプレッドシート `web_stock` から GAS 経由で毎回取得します（後述）。

---

## 構成

静的HTMLのみで、ビルド作業は不要です。ファイルを編集してコミットすれば、数分後に公開サイトへ反映されます。

```
/
├── index.html            ページ本体（1ページ構成。モーダル類もここにある）
├── script.js             全ロジック（商品取得・絞り込み・カート・注文送信・取引先ログイン・CSV出力）
├── style.css             スタイル
├── images/               商品写真・ロゴ・国旗（images/XXX.jpg を web_stock の image_main / image_variant から参照）
├── gas/                  GAS 側のソース（参照用のコピー。本番は「Order Management System」の Apps Script）
│   ├── README.md           取引先ログイン（価格の出し分け）と Telegram 自動ログインの仕組み・導入手順
│   ├── doGet-doPost.gs     doGet / doPost の本番同期版
│   ├── price-gating.gs     取引先コードの発行・検証、トークン、価格除去
│   └── telegram-login.gs   Telegram Mini App からの自動ログイン
└── README.md             このファイル
```

> **ルート直下の `index.html` / `script.js` / `style.css` は、サイトを動かしているファイルです。**
> 日々の運用（写真の追加）では `images/` 以外は触らないでください。
> 直したい箇所があるときは、自分で編集せずにみつのぶへ連絡してください。
> `gas/` は GAS のコピーです。ここを書き換えても本番の GAS は変わりません（本番は Apps Script エディタ側で変更し、`gas/` を同期します）。

### 画像を追加するとき

- `images/` 直下に置き、`web_stock` の `image_main` / `image_variant` には `images/XXX.jpg` の形で書きます。
- ファイル名は **半角英数字とアンダースコアのみ・スペースなし・大文字小文字も一致・拡張子は `.jpg`**。横 1000px 程度・300KB 以内が目安。
- GitHub のウェブ画面 `images/` → `Add file` → `Upload files` でアップロードできます（スマホ可）。
- 詳しい手順はスタッフ向け手順書「新商品の追加手順_日英版」（Google Drive）を参照。

---

## データの流れ

```
web_stock（商品マスター：products_master / variants_master / categories_master）
    │  getMergedProductData()（GAS がスクリプトプロパティ SPREADSHEET_ID で開いて読む）
    ▼
GAS ウェブアプリ /exec（Order Management System に紐づく Apps Script）
    │  GET  … 商品JSON（未認証には価格を含めない）
    │  POST … send_order / register_user / unlock / tg_login
    ▼
このサイト（script.js の GAS_URL）
    │  注文「確定する」 → POST action=send_order
    ▼
Order Management System（スプレッドシート）
    ├── Orders   … 注文行を追加（Order No = W01, W02 …／Channel = Web）
    └── Users    … 「初めての方」の登録（register_user）／Telegram 連携
    ▼
Telegram 通知（顧客 chat_id があれば顧客へ＋社内グループへ）
```

- 商品の表示・価格・在庫は **ページを開くたびに GAS から取得** します。`web_stock` を直すだけで反映され、GitHub の操作は不要です。
- `stock` が 0 の規格は表示されません（「OUT OF STOCK」タブにだけ出ます）。
- GAS の URL は `script.js` 先頭の `GAS_URL` です。GAS を「新しいデプロイ」として作り直して URL が変わった場合はここを更新します（既存デプロイの「新しいバージョン」なら URL は変わりません）。

### 注文の流れ（script.js）

1. 商品カードの `＋` でカートに入れる（`changeCartQty`）。在庫数を超えては増やせない。
2. 🛒 → 「ご注文」 → 確認モーダルで電話番号を入力 → 「確定する」（`finalizeOrderProcess`）。
3. `send_order` の応答が `status:"ok"` なら受付完了モーダル（注文番号 `W〇〇` を表示）。未登録でも拒否せず受け付ける。
4. 通信失敗・`status:"error"` のときだけ失敗モーダルを出し、カートは保持する（偽の成功表示はしない）。
5. 再送時は同じ `clientOrderId` を送るので、二重起票にならない（GAS 側で冪等処理）。

### 取引先ログイン（価格の出し分け）

卸価格は取引先コードでログインした相手にだけ表示します。仕組み・コードの発行方法・失効方法は **`gas/README.md`** を参照してください。
価格を含めるかどうかは GAS が決めており、サイト側の `pricesVisible` は表示を切り替えるだけです（防御ではありません）。

---

## 日本語 / 英語の切り替えについて

このサイトは CSS の `lang` クラスではなく、**JavaScript が文言を差し替える方式**です。

- 画面の固定文言は `script.js` の `UI_TEXT = { jp: {...}, en: {...} }` にまとめてあり、`setLang('jp' | 'en')` が `id` ごとに書き換えます。
- 初期言語はブラウザの言語（`navigator.language` が `ja` なら日本語、それ以外は英語）で決まります。
- 商品名・規格名・説明文は `web_stock` の `name_jp / name_en`、`variant_name_jp / variant_name_en`、`comment_jp / comment_en` を表示中の言語で出し分けます（片方が空なら、もう片方で代用）。

文言を追加するときは、`UI_TEXT.jp` と `UI_TEXT.en` の**両方**にキーを足し、`setLang` の `mapping` または該当の描画関数から参照してください。片方だけ足すと `undefined` が表示されます。

---

## 更新のしかた

| 変更内容 | 手順 |
|---|---|
| 写真の追加・差し替え（`images/`） | GitHub のウェブ画面から直接 `main` にアップロードしてよい |
| 文言・デザイン・注文フロー（`index.html` / `script.js` / `style.css`） | ブランチを切って Pull Request。価格表示と注文に関わるため |
| GAS の変更 | Apps Script エディタで変更 → **「新しいバージョン」として再デプロイ** → `gas/` に同期コミット |

- `index.html` は `style.css?v=20260922` / `script.js?v=20260922` のように **クエリでキャッシュを切っています**。`script.js` や `style.css` を変えたときは `v=` の日付も更新してください。更新しないと、利用者のブラウザに古いファイルが残ることがあります。
- GAS 側の変更は「保存」だけでは `/exec` に反映されません。必ず再デプロイしてください（`gas/README.md` 参照）。

### ローカルで確認する

```bash
python3 -m http.server 8000
# ブラウザで http://localhost:8000/ を開く（GAS へは本番と同じ URL でアクセスする）
```

---

## うまくいかないとき

| 症状 | よくある原因 | 確認するところ |
|---|---|---|
| 商品が1件も出ない / `⚠️ Load Failed` | GAS のデプロイが止まっている、URL が変わった、`web_stock` の ID（スクリプトプロパティ `SPREADSHEET_ID`）が違う | ブラウザで `GAS_URL` を直接開き JSON が返るか |
| 特定の商品が出ない | `variants_master` に行がない / `stock` が 0 / `product_id` が `products_master` と不一致 | `web_stock` の該当行 |
| 写真が枠だけ | ファイル名の不一致（スペース・大文字小文字・`.jpg`）/ GitHub に未アップ / `images/` 抜け | `images/` と `image_main` |
| 価格が `$0.00` | `price_usd` が空、または数字以外（`$` 記号など）が入っている | `variants_master` の `price_usd` |
| **`＋` を押しても何も起きず、注文できない** | GAS の応答に `variant_id` が無い。典型例は `variants_master` の**ヘッダー行（1行目）が書き換わっている**（`variant_id` が別の文字に化けた等）。1セルの誤入力で全商品のカート操作が効かなくなる（2026-10-25 に発生） | `web_stock › variants_master` の 1行目が `variant_id, product_id, variant_name_jp, variant_name_en, order_type, price_usd, price_unit, stock, sort_order, image_variant, inquiry_only` になっているか。ブラウザで `GAS_URL` を開き、JSON に `"variant_id"` があるか |
| 「送信できませんでした」になる | GAS 側の `send_order` が `status:"error"` を返している（`Orders` / `Users` タブ名の変更、GAS のエラー）または通信失敗 | Apps Script の実行ログ、`Orders` タブの有無 |
| 取引先コードで価格が出ない | コードの失効・期限切れ、`ACCESS_TOKEN_SECRET` 未設定、再デプロイ忘れ | `access_codes` シート、`gas/README.md` |

`web_stock` の各タブは **1行目（ヘッダー）を保護**しておくことを推奨します（データ → シートとセルを保護 → 範囲 `1:1`、警告を表示）。スタッフが毎日 `stock` / `price_usd` を編集するため、ヘッダーの誤入力がそのまま全商品の不具合になります。

---

## 関連

- 商品マスター `web_stock`: https://docs.google.com/spreadsheets/d/1SVBzUpv5BxOJHx-0U6Pjp64CVdF02ZGgBD5zgyHSLRg/edit
- 注文・顧客・GAS 本体 `Order Management System`: https://docs.google.com/spreadsheets/d/1RGMOTrXvtw5dIF2WkoAk7lv12MJR8o0ritOh9NAGQvA/edit
- 旧 URL（`Sasuraimitsu/sakanaya-productlist`）は移転案内ページのみ。リポジトリ全体の棚卸しは `sakanayajapon` の `docs/github-inventory.md`
