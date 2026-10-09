# CCAI（仮称）アプリ — SPEC-000a 基盤

スマホで開く Web アプリ（PWA）の基盤。登録・ログイン・ログアウト・アカウント削除と、「他人のデータを読めない仕組み」（データ層の分離）が入っている。AI（LLM）は、呼び出しの共通部分・プロンプトの置き場・評価コマンドだけがある（SPEC-000b）。画面・APIからはまだ呼ばない（SPEC-001 以降）。

## 前提ソフト

- Node.js 22 以上、npm 10 以上
- 自動テストに **Docker は不要**（npm から入る組み込みの PostgreSQL を使う）。`.env` も認証情報も不要
- ローカルで実際にログインするには、接続先（Supabase のプロジェクトと Postgres）が必要（下記）

## テストを1コマンドで実行する

```
cd app
npm install
npm test
```

- 内訳: `vitest`（DB分離・pair制約・削除・登録/ログイン/セッション・静的確認）→ `scripts/check-build.mjs`（`next build`、ブラウザ向け成果物に秘密が混ざらないこと、接続先なしで起動して疎通）
- 個別実行: `npm run test:unit`（vitest のみ）、`npm run test:build`（ビルド確認のみ）
- root で実行する場合: PostgreSQL は root で動かせないため、テストが自動で一般ユーザーに切り替える。切り替え先で失敗するときは `CCAI_TEST_UID` / `CCAI_TEST_GID` を指定する
- テストの DB は、Supabase の「本物」ではなく最小の互換層（shim）の上で動く。差は `docs/architecture.md` の「テストの shim と本物の差」を参照
- Supabase Auth の実サービスとの結合は自動テストに含まれない（認証は差し替え可能な部品で、テストでは偽物を使う）。実サービスでの確認は SPEC-000c

## ローカルで起動する

```
cd app
cp .env.example .env.local   # 値を入れる（任意）
npm run dev                  # http://localhost:3000
```

- **接続先なし（.env.local なし）でも、ログイン画面・登録画面は表示される。** 登録・ログインを押すと「接続先が設定されていません」と出る
- ログインまで動かすには `.env.local` に次を入れる: `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、DB の接続情報（`DB_HOST`＋`DB_PASSWORD`、または `DATABASE_URL`）、**`SIGNUP_ALLOWED_EMAILS`（登録を許すメールアドレス。空だと登録は全部断られる）**。Supabase に `supabase/migrations/` の SQL を順番に適用し、`supabase/manual/set-app-role-password.sql` でアプリ用ロールのパスワードを作っておく
- 環境変数の一覧と意味は `.env.example`。**管理用キー（`SUPABASE_SERVICE_ROLE_KEY`）をブラウザに出さない・git に入れない**
- 本番相当のビルド: `npm run build && npm start`
- アイコンの再生成（仮のアイコン）: `npm run gen:icons`

## 個人用公開（SPEC-000c）とデプロイ

- **手順書**: 非エンジニア向けのブラウザだけの手順は `docs/runbooks/deploy-personal.md`（GitHub → Supabase 東京 → Vercel 東京。すべて無料プラン）。このREADMEは開発者向けの要点だけ
- **Vercel**: Root Directory は `app`。関数の実行地域は `vercel.json`（`hnd1` = 東京。Hobby は1地域だけ）。環境変数はサーバー側のものだけ（`NEXT_PUBLIC_` は作らない。テストが確かめる）
- **新規登録の限定**: `SIGNUP_ALLOWED_EMAILS`（カンマ区切り。大文字小文字・前後の空白は無視）にあるアドレスだけ登録できる。空・未設定なら全部断る（fail closed。ログインは使える）。一覧にないアドレスは、認証基盤に送る前に固定文「現在、新規登録を受け付けていません」で断る
- **DB 接続（最小権限）**: アプリはロール `ccai_app`（テーブル権限なし、BYPASSRLS なし。`anon`／`authenticated`／`service_role` への SET ROLE だけ）で接続する。ロールは `supabase/migrations/20261008000001_app_role.sql`、パスワードは SQL に書かず `supabase/manual/set-app-role-password.sql` で作る。接続は `DB_HOST`／`DB_PASSWORD` の部品から組み立てる（Supabase のプーラーなら、ユーザー名に `.<プロジェクトID>` を自動で付け、ポートは 6543＝トランザクションモード。SSL は暗号化のみで証明書は検証しない）
- **検索エンジン**: 全ページに `X-Robots-Tag: noindex`・`<meta name="robots">`、`public/robots.txt` で全拒否
- **ログアウトは全端末**（`scope: global`）。アクセストークンが期限切れでも、更新してから失効させる（`src/server/handlers/index.ts` の `revokeAllSessions`）。PC でログアウトすると iPhone もログアウトされる
- **結合テスト（本物の Supabase と公開URL）**: `app/tests/integration/`（`*.itest.ts`）。`npm test` には含まれない。GitHub Actions の手動起動のみ（`.github/workflows/integration.yml`。Actions タブ → Integration tests → Run workflow。`standard` は数分、`long` は期限切れトークンの確認で約70分、1回だけ）。必要な秘密は GitHub の Actions secrets（手順書の手順10）。ログに秘密・トークン・本人のメールアドレスを出さず、触るのは `ccai-ci+<実行ID>-<n>@example.invalid` 形のユーザーだけ。前後で、それ以外のユーザー数とプロフィール・所属の件数を比べる。ローカルで流す場合も、同じ環境変数（`.env.example` の結合テスト用の項目）を設定して `npm run test:integration`

## LLM の共通部分（SPEC-000b）

- **すべての LLM 呼び出しは `src/server/llm/gateway.ts` の `callLlm` を通す。** 上限・タイムアウト・利用記録・月次集計は、ここで自動的に当てはまる。アプリからの入口は `src/server/llm/index.ts`（`callLlmForUser`）
- **実行方式（アダプタ）は2つ**: モック（`mock.ts`。既定。外部に通信しない）と、プラン方式（`plan.ts`。Claude Agent SDK を人間のプランの認証で呼ぶ）。`LLM_MODE` で切り替える。**自動テストの実行中は設定にかかわらずモック**。Agent SDK を直接使うのは `plan.ts` だけ（テストが確かめる）
- **プラン方式は、人間本人の開発・評価のためだけに使う。公開環境（Vercel）では使わない**（コードが拒否する。Agent SDK は開発用の依存で、公開用の関数に含めない）。規約の確認は docs/architecture.md 13-2
- APIキー方式のアダプタは、まだない（リリース準備の別SPECで、人間の承認のあとに追加する。D-010）

**アダプタの共通の形**（`src/server/llm/types.ts`）。アダプタを1つ追加するときは、この形を実装して `selectAdapter` に足すだけでよい
- `LlmAdapter`: `mode`（"mock" か "plan"）と `generate(req: AdapterRequest): Promise<AdapterResponse>`
- `AdapterRequest`（入力）: `promptName`、`system`（`app/prompts` の本文）、`input`（本文）、`model`、`maxOutputTokens`、`signal`（タイムアウトの中断）
- `AdapterResponse`（出力）: `text`、`inputTokens`、`outputTokens`、`providerCostUsd`（実行方式が返す費用の目安。参考）
- エラーは `AdapterError`。種類は `AdapterErrorKind`（`timeout`・`transient`＝一時的・`plan_limit`＝プラン側の上限・`auth`・`invalid`・`unknown`）。本文を含めない

**上限と記録**
- 上限は環境変数（`.env.example`）。**プラン方式では、上限・単価・為替・認証情報のどれかが未設定・不正なら、呼び出しをすべて「設定不足」で拒否**する。モックは、設定がなければ上限なし・費用0で動く
- 推定費用 = トークン数 ×（モデル別の単価。USD／100万トークン）× 為替。呼び出し前に「入力の見込み（1文字1トークン＋システムプロンプト）＋最大出力」を月間に予約し、呼び出し後に実際の値で確定する（同時に来ても月間上限を超えない）
- 1日（日本時間0:00で切替）の回数は、プロバイダに送った呼び出し（成功・失敗・タイムアウト）だけを数える。再試行は合わせて1回。拒否は数えない。評価コマンドの分（「システム」所有）は1日の回数に数えず、月次集計には入る
- 利用記録（`llm_usage`）と月次集計（`llm_monthly`）は、利用者は本人も読み書きできない（RLS・権限なし）。**入力・応答の本文は保存しない・ログに出さない**。結果は 成功／失敗／タイムアウト／上限超過／設定不足（呼び出し中は一時的に pending）
- タイムアウトは `LLM_TIMEOUT_MS`（仮置き30秒）。プラン方式は起動（Claude Code の実行ファイルの起動）に数秒かかる。実測で見直したら、ここに値と理由を書く
- プランの上限による拒否（使い切り・回数制限）は再試行しない。利用者向けには上限超過と同じ文言

**プロンプト**: `app/prompts/<名前>.md`（形式は `app/prompts/README.md`）。コードに埋め込まない

## 評価コマンド（SPEC-000b）

評価ケース（`docs/reviews/eval-cases.md` の EV-xx）を流し、結果を `docs/reviews/eval-runs/YYYYMMDD-HHMM-<プロンプト名>.md`（日本時間）に保存する。結果ファイルには、認証情報や設定値（単価・上限・為替）を書かない。

```
cd app
npm run eval -- --prompt _sample                          # 試走（モック）。認証情報・DB・外部通信なし
npm run eval -- --prompt _sample --cases EV-01,EV-03      # ケースIDで絞り込み
npm run eval -- --prompt _sample --real                   # 実LLM（主案。プラン方式）
npm run eval -- --prompt _sample --real --model alternate # 実LLM（代替）
```

- 実LLMの前に、件数と推定最大消費を表示する。認証情報・単価・上限・DB の接続情報が足りなければ、何も送らずに止まる。推定最大消費が今月の上限の残りを超えるなら実行しない
- 実LLMの実行分は、DB の利用記録（「システム」所有）と月次集計に残る（月間上限の判定に使うため。DB の接続情報が必要）
- 表示するのは件数・推定最大消費・保存先だけ。本文・設定値・認証情報は表示しない

**プラン方式の認証情報を用意する手順（人間が行う。実LLMの評価の前に1回）**
1. 実LLMの評価の前に、人間が Q-H11 を確認する（プランが Max、追加課金がオフ、モデル改善への協力がオフ。D-014）
2. 人間の PC に Claude Code を入れ、ターミナルで `claude setup-token` を実行する。ブラウザで Claude にログインすると、長期の認証トークンが表示される
3. そのトークンを、評価を動かす場所の `CLAUDE_CODE_OAUTH_TOKEN` にだけ入れる（PC の `.env.local`、または決めた場所の秘密情報）。**チャット・メモ・リポジトリ・Vercel には入れない**
4. あわせて `.env.example` の LLM の単価・為替・上限を設定する（単価は docs/architecture.md 第6章の公式価格。価格改定時に更新）
5. 終わったら（または漏らしたかもしれないとき）、claude.ai の設定から、そのトークン（または接続した端末）を取り消す
- 評価をどこで動かすか（人間の PC か、GitHub Actions の手動ジョブか）は未決（docs/reviews/spec-review-SPEC-000b-v3.md の問い）

## 仕組みの要点

- **認証はサーバー側だけ。** ブラウザは認証SDKを読み込まず、HttpOnly の cookie（`ccai_session`、SameSite=Lax、本番は Secure、既定30日）だけを持つ。トークンは応答の本文に出ない。POST は `application/json` のみ受け付ける（CSRF 対策）
- **データの分離は DB で行う。** サーバーは接続ごとに `SET LOCAL ROLE authenticated` とユーザーIDを設定し、行レベルセキュリティ（RLS）で本人の行だけに絞る（`src/server/db/context.ts` の `asUser` / `asAnon`）。表は既定で権限を全部取り消してから必要な分だけ許可する
- **特権（分離を迂回する接続・管理用キー）は `src/server/privileged/` の中だけ。** 外に書くとテストが失敗する
- **pair** はデータ層で制約: 最大2人、1人が active を1つまで、状態は active/ended、メンバーの付け替え不可。pair への所属は相手のデータを読む権限を与えない
- **アカウント削除**は、本人のプロフィールと所属を消し、メンバーが0人になった pair だけを消す。**相手が残る pair の行は変更しない**（SPEC-003 で扱いを決める）。そのあと認証側のユーザーを削除する
- 相談の本文などをログに出さない（エラーはコードだけを記録）

## 個人データを追加する手順

後続のSPECが個人データ（テーブル）を足すときは、この順に行う。

1. **所有者を示す列を持たせる。** 例: `user_id uuid not null references auth.users(id) on delete cascade`。`supabase/migrations/` に新しい SQL を足す
2. **分離の仕組みに登録する。** 同じ SQL で `alter table ... enable row level security`、`revoke all on ... from anon, authenticated`、必要な分だけ `grant`、そして `(select auth.uid()) = user_id` を条件にした policy を作る。ビューは RLS を迂回しうるので作らない。`tests/db-guards.test.ts` が「RLS未設定の表」「anon への権限」を検出する
3. **分離テストの共通部品で AC-9・AC-10 相当を追加する。** `tests/db-isolation.test.ts` と同じく `defineIsolationTests({...})` に表の説明（表名、所有者列、種データの作り方、更新句、偽造INSERT、本人が読めるか）を渡す。数行で、他人・連携相手・匿名による「読めない／変更・削除できない／所有者を偽って作れない」が検査される
4. **ユーザー単位の全データ削除の対象に加える。** `src/server/privileged/index.ts` の `deleteUserData` に削除文を足し（例: SPEC-000b の `llm_usage`）、`tests/account-delete.test.ts` に AC-12 相当（削除後に0件、他のユーザーの行が変わらない）を足す
5. **特権は決められた部品だけから使う。** 分離を迂回する接続・鍵は `src/server/privileged/` の中だけ。`tests/static-checks.test.ts` が、外に書かれていないことを確かめる
