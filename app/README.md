# CCAI（仮称）アプリ — SPEC-000a 基盤

スマホで開く Web アプリ（PWA）の基盤。登録・ログイン・ログアウト・アカウント削除と、「他人のデータを読めない仕組み」（データ層の分離）が入っている。AI（LLM）は含まない（000b）。

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
- ログインまで動かすには `.env.local` に次を入れる: `SUPABASE_URL`、`SUPABASE_ANON_KEY`、`SUPABASE_SERVICE_ROLE_KEY`、`DATABASE_URL`、そして Supabase に `supabase/migrations/` の SQL を適用しておく
- 環境変数の一覧と意味は `.env.example`。**管理用キー（`SUPABASE_SERVICE_ROLE_KEY`）をブラウザに出さない・git に入れない**
- 本番相当のビルド: `npm run build && npm start`
- アイコンの再生成（仮のアイコン）: `npm run gen:icons`

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
4. **ユーザー単位の全データ削除の対象に加える。** `src/server/privileged/index.ts` の `deleteUserData` に削除文を足し、`tests/account-delete.test.ts` に AC-12 相当（削除後に0件、他のユーザーの行が変わらない）を足す
5. **特権は決められた部品だけから使う。** 分離を迂回する接続・鍵は `src/server/privileged/` の中だけ。`tests/static-checks.test.ts` が、外に書かれていないことを確かめる
