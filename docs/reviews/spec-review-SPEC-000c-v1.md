# SPEC-000c v1 レビュー（開発担当・モード=レビュー）

- 対象: docs/specs/SPEC-000c.md（v1）、決定 D-015・D-016
- レビュー日: 2026-10-07（公式ドキュメントの確認日も同じ。supabase.com／vercel.com には直接接続できないため、WebFetch／WebSearch の結果による）

## 判定: 実装可

条件つきではなく、そのまま実装に進める。ただし下の「未確認」は、実装の時点では確かめられないので、結合テスト（GitHub Actions）か手順書の確認チェックリストに落とした（実装結果に対応表あり）。止める条件（第2-C章）に当たりうるものは「止める条件との関係」に明記した。

## 公式ドキュメントでの確認結果

| # | 確認したいこと | 結果 | 出典 |
| --- | --- | --- | --- |
| 1 | Vercel Hobby（無料）で関数の実行地域を東京にできるか | **できる**。Hobby は「単一の地域」。`vercel.json` の `regions` に `["hnd1"]`、または画面の Settings → Functions → Function Regions で指定する。複数地域は Pro 以上。新規プロジェクトの既定は `iad1`（ワシントン）なので、指定しないと東京にならない。東京のコードが `hnd1` であることは、同ページからは直接読み取れず、Vercel の地域一覧（/docs/regions）の知識による（**`hnd1` の表記は結合テストの AC-14 と、人間の画面確認で確かめる**） | https://vercel.com/docs/functions/configuring-functions/region |
| 2 | Vercel Hobby の費用・制限 | Hobby は無料で、個人・非商用のみ（規約に「非商用の個人利用に限る」）。上限を超えると、30日待つ形で止まる（課金ではない）。ランタイムログは **1時間分**のみ。Hobby でのクレジットカード要否は **ページに記載なし（未確認）** | https://vercel.com/docs/plans/hobby |
| 3 | Supabase 無料枠で、最小権限のログインロールを作れるか | `create role "名前" with login password '…'` は公式の手順にあり、プランによる制限の記載はない。**ただし、`postgres` ロールが `grant anon, authenticated, service_role to ccai_app` を実行できるか（それらのロールの付与権限を持つか）は公式ドキュメントに記載がなく、未確認**。実行できなければ、マイグレーションの2文目で権限エラーになる | https://supabase.com/docs/guides/database/postgres/roles |
| 4 | Supabase の Data API（REST／GraphQL）の無効化 | 「Data API integration overview」で **Enable Data API** をオフにする。オフなら「権限や RLS に関係なく、自動生成の REST は応答しない」。完全に切らない場合の代替は、`alter default privileges … revoke` で新しい表に権限を付けない方法 | https://supabase.com/docs/guides/api/securing-your-api |
| 5 | Auth のメール確認オフ・新規登録の扱い | メール確認: メール（Email）プロバイダーの設定の **Confirm email**（「初回ログイン前にメール確認が必要」）。オフにすると、メールは確認済みとして扱われる。新規登録: 一般設定の **Allow new users to sign up**（オフにすると既存ユーザーだけがログインできる）。000c では登録の許可をオンのまま、アプリ側の許可リストで限定する。**メール確認オフのとき、登録済みメールでの再登録がどんな応答（エラーコード）になるかは、公式ドキュメントに記載なし（未確認）** → 結合テスト AC-8 で確かめる | https://supabase.com/docs/guides/auth/general-configuration 、https://supabase.com/docs/guides/auth/auth-email 、https://supabase.com/docs/guides/auth/passwords |
| 6 | GitHub Actions から Supabase への接続方式 | 直接接続（`db.<ID>.supabase.co`）は IPv6。IPv4 だけの環境（GitHub Actions など）は、**共有プーラー（Supavisor）を使う**。プーラーは全プランで IPv4 対応。セッションモード（ポート5432）とトランザクションモード（ポート6543）がある。トランザクションモードは名前付きの prepared statement が使えない（`pg` は既定で使わない）。ユーザー名は `ロール名.<プロジェクトID>`。SSL は `require` を推奨 | https://supabase.com/docs/guides/database/connecting-to-postgres |
| 7 | Supabase Free の制約 | アクティブな無料プロジェクトは2つまで（一時停止中は数えない）。1週間ほど十分な利用がないと自動で一時停止し、画面の **Resume project** で再開できる（データ・設定はそのまま。復元できる期間は1年）。クレジットカード要否は **記載なし（未確認）** | https://supabase.com/docs/guides/platform/billing-faq 、https://supabase.com/docs/guides/platform/free-project-pausing |
| 8 | GitHub Actions の無料枠 | Free プランの非公開リポジトリは月 2,000分。支払い方法が未登録なら、枠を使い切ると**止まる**（課金されない） | https://docs.github.com/en/billing/managing-billing-for-your-products/managing-billing-for-github-actions/about-billing-for-github-actions |
| 9 | 既定の権限（新しい表） | 既存プロジェクトでは、`public` の新しい表に anon／authenticated／service_role の全権限が付く。ポリシーを足しても権限は取り消されない。→ 000a のマイグレーションは `revoke all` 済み（変更不要） | https://supabase.com/docs/guides/database/postgres/row-level-security |

## 止める条件（第2-C章）との関係
- 3 の `grant` が通らない場合、最小権限ロール方式は使えない（第2-C章に該当）。代わりは `postgres` ロールでの接続（`DB_USER=postgres`。アプリは変更不要）。**その場合、CI の `DB_PASSWORD` に postgres 管理者のパスワードが入る**ことになり、第2-B章の「postgres のパスワードは CI に渡さない」と衝突する。人間の判断が要る（手順書の手順4で止める指示を入れた）。
- クレジットカードの要否（Vercel、Supabase）は公式ページから読み取れなかった。手順書の各サービスの作成手順に「カード入力を求められたら止める」を入れた。

## SPEC への指摘（軽微。実装で吸収。SPEC の改訂は不要）
1. **AC-10「SSL で接続している」**: プーラー経由だと、`pg_stat_ssl` が示すのはプーラーとDBの間で、クライアントとプーラーの間ではない。結合テストは、クライアント側の接続が暗号化されていること（TLS ソケット）を確かめる形にした。証明書の検証はしていない（暗号化のみ。architecture.md 12-4）。
2. **AC-9「使用済みリフレッシュトークンの再利用が拒否される」**: Supabase にはリフレッシュトークンの「再利用の猶予」（既定10秒）があるとされる（公式の確認は未実施。結合テストは13秒待ってから再利用して確かめる）。猶予内の再利用は拒否されない。
3. **AC-14「応答ヘッダーで関数の地域を確認」**: `x-vercel-id`（`<エッジ>::<関数の地域>::<ID>`）の2番目を読む。形式は経験的な知識で、公式ページでは未確認。人間の画面確認（Settings → Functions）と併せて判定する。
4. **AC-17「登録許可の一覧の中身」**: 一覧は秘密ではないが、検査には値が要る。任意の秘密 `CI_LEAK_PROBE`（一覧のうち1件）を渡したときだけ、その値を検査に加える。渡さなければ省く（それ以外の検査は変わらない）。
5. **付録A-2 手順5「パスワードをSQLの中で生成して画面に1回だけ表示」**: SQL Editor の複数文実行で、最後の `select` の結果が表示される形にした（`pg_temp` の関数で生成・設定し、その値を返す）。ローカルの Postgres では複数文の一括実行・再実行まで確かめた。**Supabase の SQL Editor で結果が表示されるか、画面の動作は未確認**。表示されないときの代わりの手順を手順書に書いた。
6. **GitHub Actions のワークフローの置き場所**: `.github/workflows/` は GitHub の仕様でリポジトリの最上位に置く必要がある（`app/` の外）。developer.md の「コードは app/ の下だけ」の例外になる。D-015 が許可した範囲と解釈して `.github/workflows/integration.yml` を追加した（問題があれば戻す）。
7. **Vercel の Deployment Protection**: Hobby でも標準で Vercel Authentication があるとされ、個人用URLの開き方によっては Vercel のログインを求められる可能性がある（本番ドメインは対象外のことが多いが、公式での確認は未実施）。手順書の手順9に「Vercel のログイン画面が出たら止めて連絡」を入れた。
8. **新しい Supabase のキー表記**: 画面が「publishable／secret」キーを案内する場合がある。アプリは `supabase-js` に渡すだけで、どちらの形式でも動く想定だが、未確認。結合テストの最初の失敗として現れる。

## 実装への既定
- 登録の限定: 環境変数 `SIGNUP_ALLOWED_EMAILS`（カンマ区切り）。検証エラーのあと、認証基盤に送る前に判定する。
- DB 接続: `DB_HOST`／`DB_PASSWORD` の部品（`DB_USER` は既定 `ccai_app`。プーラーなら `.<プロジェクトID>` を自動で付ける。既定ポートはプーラーで 6543）。人間が接続文字列を手で組み立てない。
- A-1 の方針: 失効に失敗したら、リフレッシュトークンで更新してから失効させる。偽の認証基盤は、期限切れトークンでの失効を拒否する。
- A-8: 全端末（global）を正とし、コメント・型・README を合わせる。

## 次の担当へ
実装モードへ（本レビューに続けて実施済み）。品質担当は、結果報告の「受入基準との対応」と「人間がやる作業の一覧」を見て検収する。

## 改訂履歴
| 版 | 日付 | 内容 |
| --- | --- | --- |
| v1 | 2026-10-07 | SPEC-000c v1 のレビュー。判定: 実装可 |
| v1 追記 | 2026-10-08 | 初回の結合テストの結果を受けた追記は docs/architecture.md 12-5。指摘2（リフレッシュトークン）の想定（猶予後の再利用は拒否）は誤りで、「いま有効なトークンの親」の再利用は Supabase の仕様で通る。AC-9 の文言の扱いを戦略担当に確認する |
