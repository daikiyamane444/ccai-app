# 技術選定案（architecture）

- 状態: **人間の承認待ち**（承認は docs/decisions.md に記録されるまで有効にならない。Q-H10）
- 版: v2 / 作成: 開発担当 / 日付: 2026-10-07
- v2 の変更点: SPEC-000 v2（000a/000b に分割）、Q-P8・Q-P9 の新設、1日上限30回の仮置き反映に合わせて、第6.4章（上限値と単価設定）、第8章（cookie・登録時重複）、第9章（承認項目）を更新した。推奨構成・比較表・費用は変更なし。
- 根拠: docs/specs/SPEC-000.md 第2-A章（必須要件 T-1〜T-9、評価基準 E-1〜E-8）
- 前提: 開発するのはAIエージェント（Claude Code）、人間は非エンジニア寄り、後にAIエンジニアへ引き継ぐ構想がある。重視するのは「実装の速さ」「情報量の多さ」「引き継ぎやすさ」。
- **確認日はすべて 2026-10-07**。価格・無料枠・リージョン・データ利用ポリシー・モデル名は公式ページを取得して確認した。取得できなかった点、公式で確認できなかった点は「未確認」と書いた。為替は **1ドル=150円と仮定**（為替は未確認。概算用）。

## 1. 結論（推奨構成）

| 項目 | 推奨案A |
| --- | --- |
| フロント／バックエンド | Next.js（App Router、TypeScript）。画面とサーバー処理を1つのプロジェクトで書く。PWAのマニフェスト・Service Worker付き |
| DB | Supabase の Postgres（東京リージョン `ap-northeast-1`）。行レベルセキュリティ（RLS）でユーザー分離 |
| 認証 | Supabase Auth（メール＋パスワード）。自前でパスワードやセッションを実装しない |
| ホスティング | **SPEC-000 の範囲はローカルのみ**（公開先は Q-H8 で別途承認）。公開時の候補は Vercel（東京 `hnd1` を指定可）。 |
| アプリ内LLM | 主案 Anthropic API の Claude Sonnet 5.5（`claude-sonnet-5-5`）。代替 Claude Haiku 4.5（`claude-haiku-4-5-20251001`）。呼び出しは共通部分1か所のアダプタ経由 |
| 開発中の月額（概算） | 約3,000円（LLM上限）。インフラは無料枠。Supabase Pro を使うなら＋約3,750円 |

## 2. 候補（構成一式）

### 案A: Next.js ＋ Supabase（東京）＋ Vercel（公開時）＋ Anthropic API（Claude）
- フロント／バックエンド: Next.js（TypeScript）。
- DB: Supabase の Postgres。RLS をデータ層の分離に使う。
- 認証: Supabase Auth。
- ホスティング: ローカルで開発。公開時は Vercel（関数の実行地域を東京 `hnd1` に指定）。
- LLM: Anthropic API（Claude）。

### 案B: Next.js ＋ Firebase（Firestore 東京、Firebase Auth）＋ Google Cloud ＋ Gemini
- フロント／バックエンド: Next.js（TypeScript）。
- DB: Cloud Firestore（東京 `asia-northeast1`。作成後は地域を変更できない）。分離は Firestore セキュリティルール。
- 認証: Firebase Authentication。
- ホスティング: Firebase App Hosting は **東京が選べない**（選べるのは us-central1、us-east4、us-east5、asia-east1（台湾）、asia-southeast1（シンガポール）、europe-west4）。東京に置くなら別の仕組み（Cloud Run 等）が必要で、その東京対応は今回未確認。
- LLM: Gemini API（有料枠）。Claude を呼ぶことも可能（共通部分で差し替え）。

### 案C: Next.js ＋ Fly.io（東京）＋ Fly Managed Postgres ＋ Better Auth ＋ Anthropic API
- フロント／バックエンド: Next.js。
- DB: Fly Managed Postgres。RLS が使える Postgres。
- 認証: Better Auth などの認証ライブラリ（公式ドキュメントは今回未確認）。
- ホスティング: Fly.io のMachine（東京の割増 1.31倍）。
- LLM: Anthropic API。
- 備考: Neon（サーバーレスPostgres）は東京リージョンがない（Singapore、Sydney 等のみ）ため候補から外した。

## 3. 必須要件 T-1〜T-9 の充足

○=満たす、△=条件つき、×=満たさない、？=未確認

| ID | 要件 | 案A | 案B | 案C |
| --- | --- | --- | --- | --- |
| T-1 | iOS Safari・Android Chrome のPWA（ホーム画面追加） | ○ Next.js で標準のマニフェスト＋Service Worker を用意できる（Next.js 公式のPWAガイドは今回未確認。実装はWeb標準のため可能） | ○ 同左 | ○ 同左 |
| T-2 | データ層でユーザー分離 | ○ Postgres の RLS（`auth.uid()` と所有者列を比べるポリシー）。公式ドキュメント確認済み。注意: `service_role` は RLS を迂回するためサーバー側の限定部品だけに置く。新規テーブルは既定で匿名・ログイン済み両ロールに全権限が付くので、ポリシー追加だけでなく不要な権限の取り消しが要る。ビューは既定で RLS を迂回する（`security_invoker` が必要） | △ セキュリティルールで文書単位に制限できる（一般知識。公式の取得は今回していない）。サブコレクション・複数コレクションにまたがる削除や分離テストは、リレーショナルより設計と確認が増える | ○ Postgres の RLS（自前で設定。ロール・接続の設計は自分で行う） |
| T-3 | 認証を自前実装しない | ○ Supabase Auth（登録・ログイン・パスワード再設定に対応。公式確認。パスワード再設定ではアカウントの有無を明かさない） | ○ Firebase Auth（公式にセッションcookieの発行・失効に対応） | △ 認証ライブラリ（Better Auth 等）。公式は未確認。マネージドより自分で面倒を見る範囲が広い |
| T-4 | APIキーをサーバー側だけで保持 | ○ サーバー側の環境変数。ブラウザからLLMを呼ばない | ○ 同左 | ○ 同左 |
| T-5 | LLMが入力・出力を学習に使わない | ○ Anthropic: 「既定で、商用製品（Anthropic API 等）の入力・出力をモデルの学習に使わない」（出典1。フィードバック送信やオプトインは例外） | ○ Gemini 有料枠: プロンプト・応答を製品改善に使わない（出典5）。無料枠は使う（**無料枠は使用禁止**） | ○ 案Aと同じ |
| T-6 | 通信暗号化・保存時暗号化 | ○ Supabase: 「顧客データはAES-256で保存時暗号化」「通信はTLS」（出典7）。Vercel の通信暗号化は一般にHTTPSだが公式は今回未確認 | ○（Google Cloud の保存時暗号化は一般知識。今回公式未確認） | ○ Fly Managed Postgres: 保存時・通信とも自動暗号化（出典10）。ただし東京リージョンでの提供は未確認 |
| T-7 | ユーザー単位の完全削除。バックアップから消えるまでの期間 | ○ アプリ側で全テーブルを削除する関数を作る（SPEC-000 AC-12）。バックアップ: Pro は直近7日分（無料枠は自動バックアップなし）。削除してもバックアップが期限切れになるまで（最大7日）復元データに残る。Storage API の削除済みオブジェクトは復元に含まれない | ？ バックアップの保存期間は未確認 | ？ 保存期間は未確認 |
| T-8 | キーなし・有料契約なしでローカル起動と全テスト | ○ Supabase CLI のローカル環境（Postgres・Auth等）。**Docker 互換のコンテナ環境が必要**。Docker を使わない試験的な `supabase stack` もある（Linux と Apple Silicon の Mac）。LLMはモック | △ Firebase Emulator Suite（Auth、Firestore を含む）でローカル可。Java 等の要件・Googleアカウントの要否は今回未確認 | ○ ローカルのPostgres（Docker等）。認証ライブラリはローカルで動く |
| T-9 | 月数千円程度。プロバイダ側で利用上限・予算アラート | △ 後述。**Anthropic: Console で組織・ワークスペースごとの月間利用上限を設定でき、到達すると 429 で止まる（出典2）**。予算アラート（通知）は今回未確認 | △ 後述。Google 側の上限・予算アラートの機能は今回未確認 | × インフラだけで月 約6,000円以上（後述） |

**案C は T-9 を満たさないため推奨案にしない**（SPEC-000 第2-A章「満たさない候補は推奨案にしない」）。案Bは T-7・T-8 に未確認が残る。

## 4. 評価基準 E-1〜E-8 の比較表

| ID | 評価基準 | 案A | 案B | 案C |
| --- | --- | --- | --- | --- |
| E-1 | 保存地域（DB・ファイル・バックアップ）。日本リージョンの可否 | ○ Supabase は Tokyo `ap-northeast-1`・Osaka は一覧になし（出典6）。DB・Auth・Storage は選んだ地域に置かれる（出典7）。バックアップの保存地域は未確認。アプリ（Vercel 関数）も `hnd1`（東京）を選べる（出典4）。Vercel の Hobby は単一地域指定、Pro は複数（上限5） | ○ Firestore は東京可（作成後は変更不可、出典8）。ただし App Hosting は東京不可（出典9） | ○ Fly.io の Machine は東京（nrt）。Managed Postgres の東京提供は未確認 |
| E-2 | LLM側の入力保持期間、ゼロ保持の有無、処理地域 | Anthropic: API の入力・出力は **受領または生成から30日以内に自動削除**。利用ポリシー違反で検知された場合は最長2年、信頼性・安全性スコアは最長7年（出典3）。**ゼロ保持（ZDR）** は営業への依頼による契約（出典11）。処理地域は **global（既定）か us のみ。日本は未対応**、ワークスペースの保存地域も us のみ（出典12）。Bedrock 経由では Sonnet 5.5 は global プロファイルのみで、日本国内向け（jp）プロファイルは2026-09-29時点でなし（出典13）。注意: 「Covered Models」（Fable 5.1 等）は30日保持が必須でZDRと両立しない（出典11）。Sonnet 5.5 と Haiku 4.5 は Covered Models に挙がっていない | Gemini 有料枠: ログを不正利用の検知・安全のために「限られた期間」保持。**保持期間は具体的に書かれていない**。処理は Google や代理人が施設を持つ「どの国でも」一時保存・キャッシュされうる。地域保証なし（出典5）。Vertex AI 側（東京指定・ゼロ保持）は公式ページを取得できず**未確認** | 案Aと同じ |
| E-3 | 運用者が本文を見られる経路と減らす手段 | 経路: ①Supabase のダッシュボード（テーブル閲覧。一般に管理画面で見られる。公式の取得は今回していない）、②アプリサーバーのログ（AC-18で本文を出さない）、③Supabase・Vercel のリクエスト／クエリログ（本文が残るか **未確認**。SPEC-001前に要確認）、④Anthropic 側の30日保持（出典3。プロンプトを人が閲覧できる管理画面があるかは **未確認**）。減らす手段: アプリ層で本文を暗号化して保存（Node.js 側でAES-256-GCM等。鍵は環境変数）。ただし検索・AI処理・障害調査が難しくなる。Q-P7 推奨（a）なら MVP は基盤標準の暗号化＋運用ルール | 経路は同様（Firebase コンソールで文書を閲覧可。一般知識）。アプリ層暗号化も同様に可能 | 経路は同様（Fly の管理経路）。アプリ層暗号化も同様 |
| E-4 | セッションの有効期間・強制ログアウト | △ Supabase Auth のセッション時間制限・無操作での失効・単一セッション化は **Pro 以上のみ**（出典14）。無料プランの標準では30日の上限を設定できない | ○ セッションcookieの有効期間を5分〜2週間で指定可。リフレッシュトークンの失効APIで強制ログアウト可。HttpOnly・Secure も指定可（出典15） | ？ 選ぶ認証ライブラリによる（未確認） |
| E-5 | Web Push（iOSはホーム画面追加時のみ）への対応 | ○ Web標準のPush API＋VAPID鍵で自前送信できる（Appleは iOS 16.4 以降のホーム画面Webアプリで対応、Apple Developer Program 不要、ペイロード4KB上限、受信後すぐ通知を表示しないと許可が取り消される）（出典16）。送信予定時刻の実行には定期実行の仕組みが要る（Vercel の Cron や Supabase の定期実行。いずれも今回仕様未確認。SPEC-005 で確認） | ○ 同じWeb標準に加え FCM（Firebase Cloud Messaging）が無料（出典17）。ただしiOSの条件はWeb Push標準のまま | ○ Web標準で自前送信（案Aと同様。定期実行は自前） |
| E-6 | 月額概算・無料枠 | 後述。無料枠: Supabase Free（DB 500MB、MAU 5万、Storage 1GB、転送5GB、**自動バックアップなし、1週間無操作で一時停止**、有効プロジェクト2つまで）。Vercel Hobby は **個人・非商用に限る**（出典18, 19） | Firebase Blaze（従量課金）が必要（App Hosting等）。無料枠: Firestore 1GiB・読み5万/日・書き2万/日、Auth 月間5万人、FCM無料（出典17, 20） | Fly.io は **無料枠なし**（クレジットカード必須）。Managed Postgres は Basic $38/月〜＋保存 $0.28/GB（出典21） |
| E-7 | 日本語の情報量と引き継ぎやすさ | ◎ Next.js・Supabase・PostgreSQL は日本語の解説記事・公式の日本語情報が多い（検索結果に Zenn、Classmethod 等の日本語記事が複数出ることを確認。量の定量比較は未実施）。標準SQLのマイグレーションとRLSポリシーはファイルで残り、AIエンジニアへ引き継ぎやすい | ○ Firebase は日本語情報が豊富。ただしNoSQLの設計・ルールの独特さ、東京ホスティングが別構成になる点は引き継ぎ時の説明が増える | △ 構成要素が増え、運用（バックアップ、アップグレード、認証の保守）の説明が重い |
| E-8 | LLM差し替え時に変える範囲 | LLM共通部分のアダプタ1ファイル＋環境変数（SPEC-000 6章）。プロンプトは `app/prompts/` に独立。差し替え候補のSDK・認証方式が違う（Bedrock は地域・認証が別）が、変更範囲はアダプタ内 | 同左（Gemini との往復は同じ設計） | 同左 |

## 5. 総合比較（8項目）

| 観点 | 案A（Next.js + Supabase） | 案B（Firebase） | 案C（Fly.io + Postgres） |
| --- | --- | --- | --- |
| 実装の速さ（AIエージェントの観点） | 速い。RLS・認証・DBが一体でCLIのひな型が整っている。AIが書き慣れた構成 | やや速い。ルールの書き方・テスト方法が別体系 | 遅い。認証・DB接続・バックアップを組み立てる |
| スマホ対応（PWA） | ○ | ○ | ○ |
| 費用（開発中） | 約3,000円〜 | 約3,000円〜（Google Cloud 側の費用は未確認） | 約9,000円〜 |
| データ保護 | RLS＋東京DB＋AES-256。セッション時間制御は有料 | セッション制御は柔軟。ホスティングの東京が別構成 | 自前で多くを担う |
| 引き継ぎやすさ | 高い（標準Postgres、SQLマイグレーション） | 中 | 低〜中 |
| 判定 | **推奨** | 代替（第2候補） | 非推奨（T-9 を満たさない） |

## 6. アプリ内LLMの比較

### 6.1 候補（公式確認した料金とモデル名）

| 候補 | モデルID | 料金（100万トークンあたり、入力／出力） | 備考 |
| --- | --- | --- | --- |
| Claude Sonnet 5.5（主案） | `claude-sonnet-5-5` | $2／$10 | 知識カットオフ2026年6月。コンテキスト100万トークン（出典22） |
| Claude Haiku 4.5（代替・低費用） | `claude-haiku-4-5-20251001` | $1／$5 | 知識カットオフ2025年2月。世代が1つ古い（出典22） |
| Claude Opus 5.5（参考・高品質） | `claude-opus-5-5` | $4／$20 | 費用は主案の約2倍（出典22）。MVPでは不要と判断 |
| Gemini 3.8 Flash（別社の代替） | `gemini-3.8-flash` | $0.75／$3.75（**2026-12-31までの価格**。以後は未確認） | 有料枠のみ使用。無料枠は学習に使われるため不可（出典5, 23） |
| Gemini 3.5 Flash Lite | `gemini-3.5-flash-lite` | $0.30／$2.50 | 同上（出典23）。日本語の会話品質は未確認 |

注: モデル名・料金は取得時点の公式ページの記載。Claude の「Fable 5.1」（$10／$50）は高額かつ30日保持が必須のため対象外。

### 6.2 1回の呼び出しあたりの概算（仮定: 入力3,000トークン、出力600トークン、キャッシュなし、思考トークンは含めない）

| モデル | 1回 | 円（150円/ドル） |
| --- | --- | --- |
| Sonnet 5.5 | $0.012 | 約1.8円 |
| Haiku 4.5 | $0.006 | 約0.9円 |
| Opus 5.5 | $0.024 | 約3.6円 |
| Gemini 3.8 Flash | $0.0045 | 約0.7円 |
| Gemini 3.5 Flash Lite | $0.0024 | 約0.4円 |

月3,000円は Sonnet 5.5 で約1,600回、Haiku 4.5 で約3,300回。実際の入力は会話履歴が増えると大きくなり、思考（thinking）を使うと出力も増えるため、実測で見直す。

### 6.3 品質・安全性の比較（日本語の会話品質は公式情報では判断できない）

- 日本語の会話品質・安全性は公式文書だけでは比べられない。**確認方法を提案する**: SPEC-000b の評価コマンドで docs/reviews/eval-cases.md の EV-01〜EV-05 を Sonnet 5.5・Haiku 4.5（任意で Gemini 3.8 Flash）で流し、人間が出力を見比べて決める。5件×3モデルの費用は合計で十数円程度（上の概算より）。
- 主案を Sonnet 5.5 にする理由: ①Anthropic の「入力・出力は既定で学習に使わない」「30日以内に削除」「ZDRの契約が可能」という明確な公式文書がある（T-5, E-2）、②評価ケースの対象（伝え直し、安全経路、推測の区別）は指示への従い方と文脈理解が重要で、世代が新しい Sonnet 5.5 を選ぶほうが安全、③Haiku 4.5 より約2倍の費用だが月3,000円の上限に収まる。
- 代替案: Haiku 4.5（費用が半分。品質が足りれば切替え）、Gemini 3.8 Flash（有料枠。保持期間・地域が文書上は曖昧）。
- 日本国内処理（Q-P6 の選択肢(c)）を求める場合: Anthropic API は日本未対応（出典12）、Bedrock の Sonnet 5.5 も global のみ（出典13）。**(c)は現時点で主案では満たせない**。Vertex AI（Gemini）が東京処理を選べるかは公式ページを取得できず未確認。Q-P6 は推奨(a)（DB・バックアップは日本、LLM処理地域は問わず学習不使用は必須）に沿った案になっている。

### 6.4 上限額の提案（人間の承認が必要。D-007）

| 項目 | 開発中（提案） | 少人数の試用時（提案・再承認を要する） |
| --- | --- | --- |
| アプリ全体の月間推定費用 | 3,000円（約$20） | 10,000円 |
| 1ユーザーあたり1日の呼び出し | 30回（SPEC-000b v1 の仮置きも30回に変更済み。実際にプロバイダへ送った呼び出しのみ数える提案） | 20回 |
| 1回あたりの最大出力トークン | 800 | 800 |
| タイムアウト | 30秒（SPECの仮置きのまま） | 同左 |
| 境界のタイムゾーン | 日本時間（0:00、毎月1日 0:00。SPEC-000b で採用済み） | 同左 |
| モデル別単価（設定値。未設定のモデルは呼べない） | Sonnet 5.5: 入力$2／出力$10、Haiku 4.5: 入力$1／出力$5（出典22、100万トークンあたり） | 価格改定時に人間が更新 |
| 為替レート（設定値） | 150円/ドル | 同左 |
| 月間上限の二重の備え | Anthropic Console の月間利用上限を $20 に設定（アプリの上限とは別に、プロバイダ側で止める。出典2。アラート通知は未確認） | $70 |

注: ユーザー削除で利用記録が消えると月間費用の合計が減ってしまうため、月間の合計は個人に紐づかない月次集計として別に残す案を SPEC-000b のレビューで提案した（docs/reviews/spec-review-SPEC-000b-v1.md の問い1）。承認が要る。

注: 開発中のLLM費用の主な使い道は評価コマンド。1回の評価実行（5件）は数円なので、月3,000円は十分に余る。

## 7. 月額の概算費用（1ドル=150円の仮定。為替は未確認）

| 項目 | 案A 開発中 | 案A 少人数試用（10組=20人程度） | 案B 開発中 | 案C 開発中 |
| --- | --- | --- | --- | --- |
| DB・認証 | Supabase Free $0（バックアップなし、1週間無操作で停止）。実データを置くなら Pro $25（約3,750円。毎日バックアップ7日、セッション制御） | Supabase Pro $25（約3,750円） | Firestore・Auth は無料枠内の見込み | Fly Managed Postgres Basic $38（約5,700円）＋保存 |
| ホスティング | なし（ローカル） | Vercel Pro $20（約3,000円）。Hobby は個人・非商用のみのため、他人に使わせる試用では Pro を想定 | Google Cloud 従量（Blaze。金額は未確認） | Fly Machine 約$2.9（約430円）〜 |
| LLM（上限） | 3,000円 | 10,000円 | 3,000円 | 3,000円 |
| 合計 | **約3,000円**（Pro を使うなら約6,750円） | **約16,750円** | 約3,000円＋Google Cloud 従量 | **約9,200円〜** |

- 追加費用の可能性: Supabase の PITR は $0.137/時間〜（約15,000円/月に相当）で、MVP には不要。ドメイン代は未計上。
- 費用が発生するのは外部サービスの契約時。**SPEC-000 の実装は、ローカル環境とモックだけで完了でき、契約は不要**（AC-1, AC-2）。実LLMを使う評価実行のみ、人間が承認したAPIキーと費用上限が要る。

## 8. 案Aの確認結果と注意点（実装前に把握しておくこと）

1. **cookie（AC-8）**: Supabase の公式ガイドは「セッションcookieをHttpOnlyにする必要はない。ブラウザ側もトークンを読む設計」としている（出典24）。SPEC-000a の AC-8（ブラウザのスクリプトからトークンを読めないこと）を満たすため、ブラウザからは基盤のSDKを使わず、サーバー側だけで認証・データアクセスを行いHttpOnly のcookieを付ける構成にする（実装の最初に成立を確認。難しければ SPEC に戻して相談）。cookieを使わない方式を取る場合は、保管場所と理由をここに追記する。
2. **RLS の落とし穴**: `service_role` は RLS を迂回する。利用記録の書き込みとユーザー全データ削除に使うが、この鍵の利用は1つのサーバー側部品に限定し、ブラウザ向けビルドに含めない（AC-15 のテスト対象）。新規テーブルには既定で匿名・ログイン済みロールの全権限が付くため、テーブル作成時に不要な権限を取り消し、RLSを有効化するのをテンプレート化する（README の「個人データを追加する手順」）。
3. **メールのひな型（SPEC-000 範囲外）**: Supabase の既定のメール送信は **1時間に2通まで・ベストエフォート**で、本番はカスタムSMTP推奨（出典25）。パスワード再設定・メール確認を作る公開前SPECで外部メール送信サービス（費用・データ送信）の承認が要る。
4. **登録時の重複メール（Q-P9）**: メール確認を使わない構成では、登録済みメールでの新規登録に「登録済み」と分かる応答が返るのが標準動作。SPEC-000a は公開前まで許容する仮決定（Q-P9 (a)）で、公開準備SPECでメール確認とあわせて解消する（パスワード再設定は存在を明かさない動作と公式に記載。出典25）。
5. **ローカル実行**: `supabase start` には Docker 互換のコンテナ環境が必要（出典26）。本セッションのAI実行環境には Docker があることを確認したが、人間のPCにあるかは未確認。人間が画面確認だけをするなら、AIがローカルで起動して確認用の手順を渡す形で足りる。Docker を使わない試験的な方式（`supabase stack`）は成熟度未確認。
6. **Web Push（SPEC-005）**: iOS 16.4 以降でホーム画面に追加したWebアプリのみ。通知の許可はユーザーのタップ操作の直後に要求する必要がある。通知文には相談内容を出さない（Q-P8）。
7. **東京リージョンの確認**: DB（Supabase Tokyo）と関数（Vercel `hnd1`）は一覧で確認済み。バックアップの保存先と、Anthropic のモデル処理（日本未対応）は日本国内に限定できない。
8. **未確認で承認前に残る点**: Supabase バックアップの保存地域、Supabase・Vercel の基盤ログに本文が残るか、Anthropic の予算アラート通知、Vertex AI（Gemini）の東京処理、Better Auth の公式仕様、案Bの Cloud Run 東京と Emulator の要件。いずれも案Aの採否には影響しない（SPEC-001 の前に再確認する）。

## 9. 人間に承認してほしいこと

承認後、問い合わせ担当が `docs/decisions.md` に記録する。個別に「変更したい」ものがあれば、その項目だけ指示してください。

### A. 技術選定（Q-H10）
- [ ] 構成は **案A（Next.js ＋ Supabase（東京）＋ Supabase Auth）** でよい。ホスティングは公開まで決めず、公開先は Q-H8 で別途承認する（候補 Vercel 東京）
- [ ] 開発言語・フレームワークは TypeScript と Next.js（App Router）でよい
- [ ] 認証は Supabase Auth のメール＋パスワードでよい（パスワード再設定・メール確認は公開前の別SPEC）
- [ ] アプリ内LLMは **Anthropic API の Claude Sonnet 5.5（`claude-sonnet-5-5`）を主案**、Haiku 4.5 を代替とし、決定は評価コマンドでの比較（EV-01〜05）を見てから確定してよい
- [ ] **SPEC-000a・000b の実装はローカルとモックのみで行う**（外部サービスの契約・アカウント作成は不要）。実LLMを使う評価実行の時点で、Anthropic アカウントとAPIキーを人間が用意する

### B. 費用上限（D-007）
- [ ] アプリ全体の月間LLM費用上限: **3,000円**（開発中）
- [ ] 1ユーザー1日の呼び出し上限: **30回**（SPEC の仮置き50回から下げる提案）
- [ ] 1回の最大出力トークン: **800**、タイムアウト **30秒**
- [ ] 実LLM評価の前に Anthropic Console の月間利用上限を **$20** に設定する（人間が設定。アプリ側の上限とは別の二重の備え）
- [ ] 為替は 1ドル=150円で計算してよい（概算。実際の請求は為替で変わる）
- [ ] 少人数の試用に進むときの上限（月10,000円、1日20回）は、その時点で改めて承認する

### C. 未決事項の推奨案（Q-P6, P7, P8, U1）
- [ ] Q-P6: **(a)** DB・バックアップは日本リージョン（Supabase 東京）、LLMの処理地域は問わず、学習不使用は必須。注意: Anthropic は日本の処理地域に未対応のため(c)は不可。バックアップの保存地域は未確認
- [ ] Q-P7: **(a)** MVP開発中は基盤の保存時暗号化（AES-256）＋運用者は本文を見ない運用ルール。公開前に再判断（アプリ層暗号化は後からでも可能）
- [ ] Q-P8: SPEC-000a はログアウトのみで、セッションの有効期間は認証基盤の標準（上限なし相当）のまま。30日上限は **公開準備SPECで Supabase Pro を使って設定**（Pro は月$25。開発中から30日を必須にするなら、その費用を承認）。アプリロックは SPEC-001 より前に決める
- [ ] Q-P9（新）: 新規登録時に「登録済み」と分かる動作を、公開前まで許容する（推奨 (a)。公開準備SPECでメール確認と同時に解消し、公開前の必須条件とする）。メール確認を最初から入れる(b)はメール送信サービスの契約が要る
- [ ] Q-U1: 「18歳以上です」の自己申告チェックでよい（MVP）

### D. 進め方
- [ ] SPEC-000 を **000a（雛形・認証・分離・削除・テスト）→ 000b（LLM共通部分・プロンプト・評価コマンド）の順に分けて実装する**（戦略担当が SPEC-000 v2 で分割済み）
- [ ] 000b の月間費用の扱い（ユーザー削除後も月次集計を個人に紐づけずに残す）を認める（docs/reviews/spec-review-SPEC-000b-v1.md の問い1。プライバシーに関わるため人間の確認が要る）

## 10. 出典（確認日 2026-10-07。取得できなかったものは明記）

1. Anthropic、商用データの学習利用: https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training
2. Anthropic、利用上限（組織・ワークスペース、429 `enforced_spend_limit_reached`）: https://platform.claude.com/docs/en/api/rate-limits
3. Anthropic、データ保持（API は30日以内に削除。違反時は最長2年、スコアは7年）: https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data
4. Vercel、リージョン一覧（`hnd1` 東京）と関数地域の設定: https://vercel.com/docs/regions ・ https://vercel.com/docs/functions/configuring-functions/region
5. Google、Gemini API の利用規約（有料枠と無料枠のデータ利用）: https://ai.google.dev/gemini-api/terms
6. Supabase、リージョン一覧（Tokyo `ap-northeast-1`）: https://supabase.com/docs/guides/platform/regions
7. Supabase、セキュリティ（AES-256保存時暗号化、地域に残る）: https://supabase.com/security
8. Firebase、Firestore のロケーション（東京可・変更不可）: https://firebase.google.com/docs/firestore/locations
9. Firebase App Hosting の対応リージョン（東京なし）: https://firebase.google.com/docs/app-hosting/about-app-hosting
10. Fly.io、Managed Postgres（暗号化）: https://docs.fly.io/postgres.md
11. Anthropic、ゼロデータ保持（営業への依頼、Covered Models）: https://platform.claude.com/docs/en/build-with-claude/zero-data-retention
12. Anthropic、データ居住地（`inference_geo` は global／us のみ、日本未対応）: https://platform.claude.com/docs/en/build-with-claude/data-residency
13. Classmethod、Bedrock の Claude Sonnet 5.5（global のみ、jp プロファイルなし。2026-09-29時点の記事）: https://dev.classmethod.jp/articles/bedrock-claude-sonnet-5-5/
14. Supabase、セッション時間制限（Pro 以上）: https://supabase.com/docs/guides/auth/sessions
15. Firebase、セッションcookie（5分〜2週間、失効、httpOnly指定可）: https://firebase.google.com/docs/auth/admin/manage-cookies
16. Apple、Web Push（iOS 16.4 以降のホーム画面Webアプリ、VAPID、ペイロード4KB）: https://developer.apple.com/documentation/usernotifications/sending-web-push-notifications-in-web-apps-and-browsers
17. Firebase、料金（Spark/Blaze、FCM無料）: https://firebase.google.com/pricing
18. Supabase、料金（Free と Pro）: https://supabase.com/pricing
19. Vercel、料金（Hobby は個人・非商用、Pro $20）: https://vercel.com/pricing
20. Supabase、バックアップ（Pro 7日、PITR の料金）: https://supabase.com/docs/guides/platform/backups
21. Fly.io、料金（無料枠なし、Managed Postgres $38〜、東京 1.31倍）: https://docs.fly.io/about/pricing
22. Anthropic、モデル一覧と料金: https://platform.claude.com/docs/en/about-claude/models/overview
23. Google、Gemini API の料金とモデル名（ページ末尾の約26,000字は未読）: https://ai.google.dev/gemini-api/docs/pricing
24. Supabase、サーバー側認証の詳細ガイド（HttpOnly は必須でない）: https://supabase.com/docs/guides/auth/server-side/advanced-guide
25. Supabase、メール認証（既定SMTPは1時間2通、パスワード再設定は存在を明かさない）: https://supabase.com/docs/guides/auth/auth-email
26. Supabase、ローカル開発（Docker 互換環境が必要）: https://supabase.com/docs/guides/local-development
27. Supabase、RLS（`service_role` の迂回、既定の権限、ビュー）: https://supabase.com/docs/guides/database/postgres/row-level-security
28. Neon、リージョン一覧（東京なし）: https://neon.com/docs/introduction/regions

取得に失敗または内容を確認できなかったもの:
- Google Vertex AI（Gemini）のデータガバナンス: 元のURLは404、移転先のページも本文が取得できず（**Vertex AI の学習不使用・保持・東京処理は未確認**）。
- Supabase の「暗号化・バックアップ・削除」の詳細ドキュメント、Next.js の公式PWAガイド、Better Auth の公式ドキュメント、Firebase Emulator の動作要件、Cloud Run の東京対応、Anthropic の予算アラート: 今回は取得せず、または確認できず（未確認）。
