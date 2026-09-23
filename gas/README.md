# 価格の出し分け（取引先ログイン）

卸価格を取引先だけに見せるための仕組み。2026-09 導入。

## なぜ必要だったか

カタログは GitHub Pages の静的配信で、価格は GAS から動的に取得している。
導入前は `doGet` に認証がなく、**URL を開いた全員に全商品の価格が返っていた**。
さらに CSV の一括ダウンロードがあり、価格表を丸ごと持ち出せた。

フロント側の分岐は防御にならない（HTML も JS も読めるため）。
**価格をそもそも応答に含めない**ことだけが実効性のある対策になる。

## 関係するファイル

| 名前 | 役割 |
|---|---|
| `自動注文管理ソフト` | **スクリプトの置き場所**。注文履歴・顧客情報。`access_codes` もここに作られる |
| `gas/price-gating.gs` | 新規追加するファイル（トークンの発行・検証、コード管理、価格除去） |
| `gas/doGet-doPost.gs` | 既存の doGet / doPost を置き換える完成版（本番では `IN&DN.gs` 内にある） |
| `gas/telegram-login.gs` | Telegram Mini App からの自動ログイン（initData の署名検証・G列との照合） |
| `web_stock` | 商品マスター。商品名・価格・在庫の入力元。スクリプトがIDで読みに行く |

`access_codes` は `SpreadsheetApp.getActive()`、すなわちスクリプトが紐づく
`自動注文管理ソフト` 側に作られる。`Users` や `注文集計` と同じ場所になるので都合がよい。

> **既存の `SPREADSHEET_ID` には触れないこと。**
> このプロジェクトでは `SPREADSHEET_ID` は**商品マスター（web_stock）のID**を指しており、
> `getMergedProductData()` が `openById` で読みに行く。`checkRequiredProperties_` の必須キーでもある。
> 価格の出し分けはこのキーを一切読まない（専用キー `ACCESS_CODES_SS_ID` を用意してあるが、
> 通常は未設定のままでよい）。

## 全体の流れ

```
店側                          客側                        GAS
issueAccessCode('店名')
  → SJ-XXXX-XXXX を発行
  → Telegram でコードを伝える
                         カタログで「🔓 取引先ログイン」
                         コードを入力 ──────────→ action='unlock'
                                                  access_codes を照合
                         ←─── 署名付きトークン ───  issueToken_()
                         （localStorage に保存）
                         以降 ?token=... で取得 ──→ doGet が検証
                         ←─── 価格つきの応答 ────  通れば価格を含める
                                                  通らなければ stripPrices_
```

## 導入手順

0. **`自動注文管理ソフト`** を開き、**拡張機能 → Apps Script** でスクリプトを開く
   https://docs.google.com/spreadsheets/d/1RGMOTrXvtw5dIF2WkoAk7lv12MJR8o0ritOh9NAGQvA/edit
   （2026-07-05 作成の新ブック。注文履歴と顧客情報が入っており、`doGet` / `doPost` はここに紐づく）
1. Apps Script エディタに `price-gating.gs` の内容を追加する
2. `setupAccessSecret()` を1回実行する（HMAC の秘密鍵を生成）
3. `ensureAccessCodeSheet()` を1回実行する（`access_codes` シートを作成）
4. 既存の「2. 外部連携（doGet / doPost）」を `doGet-doPost.gs` の内容で置き換える
   （差し込み済みの完成版。`send_order` / `register_user` の処理と応答は変えていない）
5. **ウェブアプリを新しいバージョンとして再デプロイする**
6. その後でカタログ側（`index.html` / `script.js` / `style.css`）を公開する

**順番が重要**: 5 を先に済ませること。逆順でも表示は壊れないが、価格が見えたままの時間が延びる。

> カタログ側は「応答に価格が実在するか」で表示を決めているため、
> 旧 GAS のままカタログを公開しても画面は壊れない（従来どおり価格が出るだけ）。
> この性質のおかげでデプロイ順の事故が表示崩れにはならないが、
> **防御が効き始めるのは 5 を終えた時点**であることに注意。

## 日々の運用

### 新しい取引先にコードを渡す

Apps Script エディタで実行する。

```js
issueAccessCode('レストランABC');        // 既定は365日有効
issueAccessCode('ホテルXYZ', 180);       // 日数を指定する場合
```

実行ログに `SJ-XXXX-XXXX` が出るので、これを Telegram で先方へ伝える。
客はカタログの「🔓 取引先ログイン」に一度入力すれば、以降 90 日は自動で価格が見える。

### コードを失効させる

取引先との取引終了時、コードが外部に漏れた疑いがあるときに実行する。

```js
revokeAccessCode('SJ-XXXX-XXXX');
```

そのコードで発行済みのトークンも、この時点から通らなくなる（最大5分のキャッシュ遅延あり）。

### 棚卸し

`access_codes` シートの `last_used_at` 列に最終ログイン日時が入る。
長期間使われていないコードは失効させておくとよい。

## Telegram からの自動ログイン（2026-09-22）

法人向け Bot のメニューボタン／インラインボタンからカタログを開いた取引先を、
コード入力なしでログイン済みにする。通常ブラウザで開いた場合は一切動作しない。

```
Telegram Bot ──web_app ボタン──→ カタログ（script.js）
                                  起動ハッシュ tgWebAppData を検出
                                  SDK を動的に読み込み、initData を取得
                                  ──── action='tg_login' ────→ GAS（telegram-login.gs）
                                                                Bot トークンで initData の署名を検証
                                                                access_codes G列 telegram_chat_ids と照合
                                  ←── 署名付きトークン ────────  issueToken_()（従来と同じ）
```

### 紐付けのされ方

- 取引先が Telegram から開いたカタログでコードを1回入力すると自動で紐付く
  （`doPost` の unlock 分岐が `linkTelegramAfterUnlock_` を呼ぶ）
- 取引先が Bot に `/link SJ-XXXX-XXXX` を送っても紐付く（`TelegramMenu.gs`）
- スタッフがエディタで `linkTelegramChatManually('SJ-XXXX-XXXX', 123456789)` を実行しても紐付く
- 1つのコードに複数の chat_id（同じ店の複数スタッフ）をカンマ区切りで紐付けられる
- 特定の人だけ外すときは `unlinkTelegramChat(chatId)`。コードごと止めるなら従来どおり `revokeAccessCode`

### 導入時の確認事項

1. スクリプトプロパティ `BOT_TOKEN`（法人専用 Bot を別に立てた場合は `MENU_BOT_TOKEN`）に、
   カタログを開く Bot のトークンが入っていること
2. `telegram-login.gs` を追加し、`doGet-doPost.gs` の内容で doPost を更新したうえで、
   **ウェブアプリを新しいバージョンとして再デプロイする**（保存だけでは /exec の挙動は変わらない）
3. Bot のボタンは通常の `url` ではなく **`web_app` 形式**でカタログの URL を指定すること。
   通常リンクだと Telegram が起動ハッシュを付けないため、自動ログインは動かない
4. 動作確認: 未紐付けのアカウントで開く → 従来のログインボタン → コード入力 →
   「次回からは Telegram で開くだけで価格が表示されます」 → 閉じて再度開く → コード入力なしで価格が出る

### 安全策

- initData は Bot トークンで HMAC-SHA256 署名されているため、改ざん・なりすましはできない
- `auth_date` が24時間より古い initData は拒否する（起動データの使い回し防止）
- 検証に通っても未紐付けなら `status:'unlinked'` を返し、カタログは通常のログインボタンを出す
- カタログ側は失効時の自動再ログインを1回の表示につき1度しか試さない（無限ループ防止）

> `TelegramMenu.gs`（法人向け常設メニュー・Webhook 受信）と `partner-codes.gs`（コードの一括発行・配布）は
> 本番プロジェクトにあるが、本リポジトリには未収録。

## 仕様

| 項目 | 値 | 変更箇所 |
|---|---|---|
| トークンの有効期間 | 90日 | `TOKEN_TTL_DAYS` |
| コードの既定有効期間 | 365日 | `CODE_TTL_DAYS` |
| コードの桁数 | 英数字8文字（約1.1兆通り） | `generateAccessCode_()` |
| 取消判定のキャッシュ | 5分 | `isCodeActive_()` |

- トークンは HMAC-SHA256 の署名付きで、シートには保存しない（検証にシート読み取りが不要）
- コードには紛らわしい文字（0/O/1/I/L）を使わない。口頭やチャットで伝えても取り違えにくい
- ログイン失敗時に理由（存在しない／失効）は返さない

## この対策の限界

正直に書いておく。

- **認証済みの客からは守れない。** ログインした取引先は価格を見られるし、CSV も出せる。
  取引先経由での流出は仕組みでは防げない。コードを取引先ごとに分けてあるので、
  漏洩元の切り分けと個別失効はできる。
- **接続元IP単位の制限ができない。** Apps Script では接続元IPが取れないため、
  総当たりへの備えはコードの桁数（約1.1兆通り）と失敗時の遅延にとどまる。
  IP単位の制限が必要になったら、Cloud Run 等を前段に置く構成に変える必要がある。
- **トークンが URL のクエリに載る。** Google 側のログに残りうる。
  気になる場合は `doGet` を `doPost` に変える必要があるが、既存の取得経路の変更を伴う。
- **導入前に持ち出された価格表は取り戻せない。** 公開期間中に取得された分は残る。

## 関連

- 公開前の状態と経緯: `sakanayajapon` の `docs/github-inventory.md` §2
- 旧試作版に価格が残っている件: 同 §2「`sakanayajapon-air` の後始末」
