# 技術選定案（architecture）

- 状態: **承認済み（D-009〜D-012。2026-10-07、人間）**。構成は案A（D-009）、LLM の実行方式は D-010、プライバシー5項目は D-011、月次集計は D-012
- 版: v3 / 作成: 開発担当 / 日付: 2026-10-07
- v3 の変更点: 状態を承認済みに更新。アプリ内LLMの実行方式を D-010（リリースまでは Claude Agent SDK＋プランの認証、追加課金なし、APIキーはリリース時に再承認）に合わせて書き換え（第1章、第6.5章を新設、第6.4・7章）。Agent SDK の公式確認結果（認証、ツール無効化、設定ファイル、会話記録、使用量）と、確認で分かった事実（月次クレジットは現在停止中、第三者提供は不可、個人向けプランの学習利用の条件）を追記。第9章に承認結果を反映し、出典29〜39を追加。比較表（第3〜5章）の案A/B/C の結論は変更なし。
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
| アプリ内LLM（D-010） | モデルは Claude。主案 Sonnet 5.5（`claude-sonnet-5-5`）、代替 Haiku 4.5（`claude-haiku-4-5-20251001`）。**リリースまでは Claude Agent SDK（TypeScript）を人間の契約中のプランの認証で呼ぶ（追加課金なし）**。呼び出しは共通部分1か所のアダプタ経由（モックとプラン方式）。**リリース時は APIキー（従量課金）のアダプタを追加し、そのとき費用上限を再承認**（第6.5章） |
| 開発中の月額（概算） | 追加の請求はなし（LLM はプランの利用上限の範囲内。**ただし普段使いの Claude と上限を分け合う**）。インフラは無料枠。Supabase Pro を使うなら＋約3,750円（未承認） |

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

### 6.4 上限額（D-010 により、プラン方式では「消費の目安」。API方式に切り替えるときの表として残す）

注: 下の金額は **APIキー（従量課金）で呼ぶ場合の請求の上限案** として作った。D-010 で、リリースまではプランの範囲内で実行し追加課金を有効にしないことが決まったため、プラン方式では請求は発生せず、この金額は「API定価に換算した消費の目安」（SPEC-000b の月間推定費用）として使う。目安の仮置きは、API定価換算で月3,000円相当、1日30回、最大出力800トークン、タイムアウト30秒（Q-H11 で人間が確認）。APIキー方式に切り替える（リリース時、または他人に使わせる段階）ときは、費用上限を改めて承認する（D-010）。

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

### 6.5 リリースまでのLLM実行方式: Claude Agent SDK ＋ プランの認証（D-010。公式ドキュメントでの確認結果）

確認日はすべて 2026-10-07。出典は第10章の29〜39。

**結論: 技術的には成り立つ。ただし前提の一部が現状と異なる（事実A〜C）。SPEC-000b v2 の受入基準は満たせる見込み（レビュー: docs/reviews/spec-review-SPEC-000b-v2.md、判定「実装可」）。**

| 確認点 | 結果（出典番号） |
| --- | --- |
| プランの認証で動くか | ○ `claude setup-token`（Pro/Max/Team/Enterprise向け、有効期間1年のOAuthトークン）の出力を、環境変数 `CLAUDE_CODE_OAUTH_TOKEN` に設定する。CI・スクリプト向けとして公式に説明（30）。このトークンは「モデルへの要求だけ」ができる。`/login` のログイン情報でも動く（Linuxは `~/.claude/.credentials.json`、30）。`ANTHROPIC_API_KEY` が環境にあると、非対話実行では APIキーが優先される（30） |
| ツールの全無効化 | △ `tools`・`disallowedTools` がある（32）。`tools: []` が全無効になる明記は未確認。`disallowedTools` に既知のツール名を並べ、権限モード `dontAsk` を併用する二重の設定にする（確認は実装時の自動テストで行う） |
| 設定ファイル等を読ませない | ○ `settingSources: []`、`skills: []`（33）。ただし管理ポリシー、`~/.claude.json`、自動メモリ、claude.ai のコネクタは別。`env` で `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1` と空の一時ディレクトリの `CLAUDE_CONFIG_DIR` を渡す（33, 36） |
| 1往復 | ○ `maxTurns` はツール使用の往復だけを数える（34）。ツールがなければ1回の応答で終わる。`maxTurns: 1` 指定時の境界挙動は未確認 |
| 会話記録の保存無効化 | ○ TypeScriptは `persistSession: false`（32, 35）。自動メモリ・テレメトリも止める（36） |
| モデル指定 | ○ `model` に別名または完全なモデル名（32）。契約中のプランで Sonnet 5.5 / Haiku 4.5 が選べるかは未確認 |
| 最大出力トークン | △ 専用のオプションなし。環境変数 `CLAUDE_CODE_MAX_OUTPUT_TOKENS` を `env` で渡す（36）。思考を止める設定（`CLAUDE_CODE_DISABLE_THINKING` 等）も併用 |
| タイムアウト | △ アダプタ側の `abortController`（32）。`API_TIMEOUT_MS`（既定10分）等もある（36）。30秒で中止する設計 |
| 使用量の取得 | ○ 結果に `usage`、`modelUsage`、`total_cost_usd`（クライアント側の推定。失敗時も付くがクラッシュ時は0になりうる）（32, 34）。月間推定費用は SPEC のとおり「トークン数×API定価」で計算し、この値は参考とする |
| エラーの見え方 | ○ 結果の `subtype`（`error_max_turns` 等）。1回きりの `query()` はエラー結果の後に例外を投げる（34）。プランの利用上限に達したときのエラー種別は未確認（実装時に実測） |

**事実A: 月次クレジットは現在停止中。** 公式サポート記事に「6月15日の更新: 変更を一時停止。現状は何も変わらず、Agent SDK、`claude -p`、第三者アプリの利用はサブスクリプションの利用上限から消費される」とある（29。年は取得した本文には出ておらず未確認）。別の記事（37、2026-05-13付）はクレジット有効としているが、公式の停止の更新を正とする。よって実際は、別枠のクレジットではなく **普段使いの Claude（対話・Claude Code・このハーネスの開発作業）と同じ利用上限を共有** し、追加課金（利用クレジット）が無効なら上限到達で止まる。D-010 の趣旨（追加課金なし）は成り立つが、評価を多く流すと開発作業が止まりうる。

**事実B: 第三者への提供は許可されていない。** 公式は「事前の承認がない限り、第三者の開発者は claude.ai ログインやレート制限を自分の製品で提供することを認めない。APIキーを使う」としている（31, 38）。自分の開発・評価は範囲内と読めるが、パートナーなど他人が使う段階（Q-H12）は APIキー方式への切替えが必要になる可能性が高い。

**事実C: 個人向けプランの学習利用の条件。** 個人向けプラン（Free/Pro/Max）の会話・コーディング履歴は、「モデル改善への協力」を許可した場合と、安全のために検出された場合に学習に使われうる（39）。API（商用）は既定で使わない（1）。Agent SDK を「商用規約に従う」とする記述（31）と、プランの認証で動かす場合にどちらの規約が適用されるかは未確認。D-011「学習不使用は必須」のため、人間がプランの設定で「モデル改善への協力」をオフにする（Q-H11(2)）。保持期間（オフ時）は未確認。

**設計上の決め（SPEC-000b v2 に沿う）:**
- アダプタは `CLAUDE_CODE_OAUTH_TOKEN` 方式を第一とし、`ANTHROPIC_API_KEY` が環境にあればプラン方式のアダプタは起動を拒否する（意図しない従量課金の防止）。
- SDK に渡す `env` は必要な変数だけを明示する。
- APIキー方式のアダプタは SPEC-000b の範囲外。リリース準備時に追加する（人間の承認後）。モック・プラン方式・APIキー方式は同じ共通の形で差し替える。

## 7. 月額の概算費用（1ドル=150円の仮定。為替は未確認）

注: LLM の行は、**APIキー方式の場合の費用**。D-010 により、リリースまでのプラン方式では LLM の追加請求はない（プランの利用上限の範囲内）。

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

承認結果の記録は docs/decisions.md の D-009〜D-012。以下は、承認項目と結果（人間の回答: inbox/20261007-1530-tech-approval.md）、およびこの版で新たに人間に確認してほしい点。

### A. 技術選定（Q-H10）— 承認済み（D-009）
- [x] 構成は案A（Next.js ＋ Supabase（東京）＋ Supabase Auth）。ホスティングは公開まで決めず、公開先は Q-H8 で別途承認する（候補 Vercel 東京）
- [x] TypeScript と Next.js（App Router）、認証は Supabase Auth のメール＋パスワード（再設定・メール確認は公開前の別SPEC）
- [x] SPEC-000a・000b の実装はローカルとモックのみ（外部サービスの契約・アカウント作成は不要）

### B. アプリ内LLMと費用（D-007 を具体化した D-010）— 承認済み。ただし前提の更新あり
- [x] モデルは Claude（主案 Sonnet 5.5、代替 Haiku 4.5。評価ケース EV-01〜05 で比較して確定）
- [x] リリースまでは契約中のプランの範囲内で Claude Agent SDK を使い、追加課金は有効にしない。リリース時の APIキー（従量課金）への切替えと費用上限は、その時点で再承認
- [ ] **【新規確認】事実A**: 月次クレジットは現在停止中で、実際は普段使いの Claude（このハーネスの開発作業を含む）とプランの利用上限を共有する。それでよいか（評価は件数を絞る前提）
- [ ] **【新規確認】事実B**: パートナー等、他人が使う段階（Q-H12）は、公式上この方式では許可されない可能性が高いため、その段階で APIキー方式に切り替える前提でよいか
- [ ] **【新規確認】事実C**: 個人向けプランの「モデル改善への協力」をオフにする（Q-H11(2)）。オフでも保持期間などが未確認のため、SPEC-001（実利用者の本文を送る）の前に再確認する
- [ ] Q-H11: 契約中のプランは Pro か Max か、追加課金（利用クレジット）が無効か、契約中のプランで Sonnet 5.5 と Haiku 4.5 が選べるか（実LLM評価の前までに回答）
- [ ] 消費の目安（アプリ側の自己管理の数字）: API定価換算で月3,000円相当、1ユーザー1日30回、最大出力800トークン、タイムアウト30秒（SPEC-000b の仮置きのまま。Q-H11 で確認）
- [ ] 為替は 1ドル=150円（単価換算用の設定値。概算）

### C. プライバシー5項目（D-011）— 承認済み（推奨案どおり）
- [x] Q-P6 (a)：DB・バックアップは日本リージョン、LLMの処理地域は問わず、学習不使用は必須。注意: 事実C のとおり、プラン方式の学習不使用は設定（オフ）に依存する。Anthropic は日本の処理地域に未対応のため(c)は不可
- [x] Q-P7 (a)：開発中は基盤の保存時暗号化（AES-256）＋運用者は本文を見ない運用。公開前に再判断
- [x] Q-P8：30日のセッション上限は公開準備SPECで設定（Supabase Pro、月$25）。アプリロックは SPEC-001 より前に決める
- [x] Q-P9 (a)：登録時に「登録済み」と分かる動作は公開前まで許容し、公開前に必ず解消
- [x] Q-U1：「18歳以上です」の自己申告チェック

### D. 進め方と月次集計（D-012）— 承認済み
- [x] 000a → 000b の順に実装（分割済み）
- [x] ユーザー削除後も、個人に紐づかない月次集計（年月・合計費用・回数）は残してよい（D-012）

### E. 未決（人間が後で確認）
- [ ] Q-H12：二人での試用が「自分のプロジェクトでのプラン利用」に収まるか。事実B から、APIキー方式への切替えが必要になる可能性が高い（その場合、費用上限を再承認）

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

追加の出典（v3。確認日 2026-10-07）:
29. Anthropic サポート、Agent SDK とプラン（月次クレジットは一時停止中、SDK の利用はサブスクリプションの利用上限から消費）: https://support.claude.com/en/articles/15036540-use-the-claude-agent-sdk-with-your-claude-plan
30. Claude Code、認証（`claude setup-token`、`CLAUDE_CODE_OAUTH_TOKEN`、認証の優先順位、認証情報の保存場所）: https://code.claude.com/docs/en/authentication
31. Agent SDK の概要（第三者がclaude.aiログインを提供することは許可されない、商用規約に従う）: https://code.claude.com/docs/en/agent-sdk/overview
32. Agent SDK TypeScript リファレンス（`tools`、`disallowedTools`、`settingSources`、`systemPrompt`、`persistSession`、`maxTurns`、`model`、`abortController`、`env`、`maxBudgetUsd`、結果の `usage`／`total_cost_usd`。ページ末尾約6,000字は一部のみ確認）: https://code.claude.com/docs/en/agent-sdk/typescript
33. Agent SDK、Claude Code の機能の読み込み（`settingSources: []`、読み込みが止まらない入力）: https://code.claude.com/docs/en/agent-sdk/claude-code-features
34. Agent SDK、エージェントループ（`maxTurns` の意味、結果の `subtype`、エラー時の例外）: https://code.claude.com/docs/en/agent-sdk/agent-loop
35. Agent SDK、セッション（`persistSession: false`、保存場所）: https://code.claude.com/docs/en/agent-sdk/sessions
36. Claude Code、環境変数（`CLAUDE_CODE_MAX_OUTPUT_TOKENS`、`API_TIMEOUT_MS`、`CLAUDE_CODE_DISABLE_AUTO_MEMORY` 等。ページ末尾約7,000字は未読）: https://code.claude.com/docs/en/env-vars
37. AI Weekly、Agent SDK のクレジット（2026-05-13付。停止の更新より前の記事。参考のみ）: https://aiweekly.co/alerts/anthropic-caps-claude-agent-sdk-credits-by-plan-tier
38. Agent SDK クイックスターター（APIキーの設定、同梱バイナリ、第三者のログイン提供の注記）: https://code.claude.com/docs/en/agent-sdk/quickstart
39. Anthropic、個人向けプランのデータ利用（「モデル改善への協力」を許可した場合に学習に使う）: https://privacy.claude.com/en/articles/10023580-is-my-data-used-for-model-training

v3 で確認できなかった点（未確認）: 月次クレジット停止の更新の年、`tools: []` で全ツールが無効になること、契約中のプランで Sonnet 5.5／Haiku 4.5 が選べるか、プランの利用上限に達したときのエラー種別、プランの認証で動かす場合に適用される規約（個人向けか商用か）、個人向けプランでオフ時の保持期間、`maxTurns: 1` の境界の挙動。

---

## 11. 実装メモ（SPEC-000a 実装時に追記。2026-10-07）

### 11-1. テストの shim と本物の差

実行環境の制約（Docker のレジストリが 403 で、`supabase start` が使えない）のため、DB テストは npm の組み込み PostgreSQL（`embedded-postgres`）の上で、`supabase/migrations/` の SQL をそのまま適用して行う。足りない Supabase 側の部品は `app/tests/shim/supabase-shim.sql` の最小互換層で補う。

shim の範囲:
- ロール `anon` / `authenticated` / `service_role`（`service_role` は RLS 迂回）と、`public` スキーマへの既定の権限（Supabase の既定に似せる）
- `auth` スキーマ、最小の `auth.users`（id、email のみ）、`auth.uid()`（`request.jwt.claims` の `sub` を読む）

本物との差（テストでは確認できないもの）:
- 本物の Auth サービス（登録・ログイン・トークン・失効）はない。認証は `AuthProvider` の差し替え部品で、テストは偽物（`fake.ts`）を使う。偽物は `auth.users` に反映するので、外部キーと削除の連動は実DBで確認される
- 接続ロールがスーパーユーザーである。Supabase の `postgres` ロールが `SET ROLE authenticated / service_role` できる前提は未確認（000c で確認）
- 文字コードは UTF8、ロケール `C.UTF-8` を指定している（本物の既定と一致するかは未確認）
- 接続プーラー（トランザクションモード）、SSL、リージョン、バックアップはない
- Supabase 側が新しい表に自動で付ける権限の挙動（本物のダッシュボード作成の表など）は再現しない。マイグレーションは明示的に取り消す書き方にしている

### 11-2. SPEC-000c に回す確認項目（実サービス・実機でしか確認できないもの）

Supabase 実サービス:
1. 登録済みメールでの新規登録の応答（エラーコード、メール確認設定がオフのときの挙動）が、アダプタ `src/server/auth/supabase.ts` の想定（「登録済み」と分かる応答）と合うこと
2. ログアウトでのセッション失効（`admin.signOut(jwt)`）が効き、失効後の `getUser` が拒否されること。リフレッシュトークンが1回限りで回転し、使用済みの再利用が拒否されること
3. メール確認を「オフ」にした設定（登録直後にログインできる前提）
4. Supabase の `postgres` ロールで `SET LOCAL ROLE authenticated / service_role` が通ること。`DATABASE_URL` の接続方式（プーラー/直接、トランザクションモードでの `SET LOCAL` の動作）、SSL
5. 新しい表の既定権限の挙動（`anon` / `authenticated` に自動で付く権限がマイグレーションで取り消されていること）を、実プロジェクトの権限一覧で確認
6. バックアップの保存場所（リージョン）と、アカウント削除後に個人データが残らないこと（D-012 の集計を除く）

Vercel / HTTPS / 実機:
7. Vercel 上で `next build` が通り、環境変数がサーバー側だけに渡ること（ブラウザの成果物に出ない）
8. HTTPS で cookie に Secure が付き、HttpOnly で JS から読めないこと（ブラウザの開発者ツール）
9. iPhone のホーム画面に追加でき、アイコン・名前・全画面表示になること（人間の確認。AC-16）
10. スマホ幅での見た目（入力欄の拡大が起きない、ボタンが押しやすい、横スクロールなし。AC-15）
11. 戻るボタンで、ログアウト後に保護画面の内容が見えないこと（`ReloadOnBack` の実機確認。AC-6）
12. オフライン時の表示（Service Worker は何もキャッシュしないので、通信がないとき画面が出ないこと自体が仕様。AC-17）
13. セッションの有効期間（既定30日）。認証基盤側の上限設定は公開準備SPEC（有料プランが必要。Q-P8）

000c で作らない（後続）: 登録メールの制限、独自ドメイン、メール送信、パスワード再設定、監視。

### 11-3. 設計上の判断（後続SPECへの引き継ぎ）
- アカウント削除で、相手が残る pair の行は変更しない（「他のユーザーのデータは1件も変わらない」の解釈）。メンバー0人になった pair のみ削除する。相手残存時の pair の扱い（ended にするか等）は SPEC-003 で決める
- Next.js 16 の RSC は cookie を設定できないため、アクセストークンの期限切れ時はホームが `GET /api/auth/refresh` へ移し、更新後に戻す（`?r=1` でループを防ぐ）

---

## 12. 個人用公開（SPEC-000c）の実装メモ（2026-10-07 追記）

### 12-1. 追加・変更した設計
- **アプリ用の最小権限DBロール `ccai_app`**（マイグレーション `20261008000001_app_role.sql`）: テーブル権限なし・BYPASSRLS なし・NOINHERIT。`anon`／`authenticated`／`service_role` への SET ROLE だけができる。パスワードはSQLに書かず、`supabase/manual/set-app-role-password.sql`（DBの中で生成して1回だけ表示）で設定する。ローカルの自動テストも、このロールで接続する（SET ROLE を忘れた処理は権限エラー 42501 になることをテストで確認）。
- **登録の限定**: `SIGNUP_ALLOWED_EMAILS`（サーバー側の環境変数）。`services/signup-policy.ts` の方針部品に切り出し、`registerUser` が入力検証のあと・認証基盤の呼び出しの前に判定する。空・未設定は全部拒否。固定文で断り、理由は伝えない。
- **DB 接続情報**: `DB_HOST`／`DB_PASSWORD` などの部品から組み立てる（人間が接続文字列を手で作らない）。`DATABASE_URL` も引き続き使える（自動テスト）。Supabase のプーラーではユーザー名に `.<プロジェクトID>` を自動で付け、既定ポートは 6543（トランザクションモード。`SET LOCAL` は `BEGIN`〜`COMMIT` の中で完結するので動作する想定。結合テストで確認）。
- **ログアウト（A-1・A-8）**: 全端末（`scope: global`）を正とする。アクセストークンが期限切れで失効要求が拒否されたら、リフレッシュトークンで更新してから、新しいトークンで失効させる。偽の認証基盤も、本物と同じく期限切れ・失効済みトークンでの失効を拒否する（これで A-1 がテストで再現できる）。
- **検索エンジン**: `X-Robots-Tag: noindex, nofollow, noarchive`（全パス）、`<meta name="robots">`、`public/robots.txt`。
- **Vercel**: `vercel.json` で `regions: ["hnd1"]`（Hobby は単一地域のみ）。環境変数は `NEXT_PUBLIC_` を使わない（テストが確認）。
- **結合テスト**: `app/tests/integration/*.itest.ts` と `.github/workflows/integration.yml`（手動起動のみ）。DDL・設定変更をしない。触るのは `ccai-ci+<実行ID>-<n>@example.invalid` のユーザーだけで、前後で他のユーザー数とプロフィール・所属の件数を比べる。ログには値を出さない。
- **ビルド検査**: ブラウザに配信される `.rsc` も検査対象に追加（A-5）。ダミーの登録許可リスト・DB 部品の値も漏れ検査に加えた。

### 12-2. 11-2 の確認項目と QA 追加推奨の確認状況（実施結果は、結合テスト・人間確認のあとに追記する）

| 11-2 項目 | 確かめ方（SPEC-000c） | 状況（2026-10-07 時点） |
| --- | --- | --- |
| 1 重複登録の応答、登録直後のログイン | 結合テスト AC-8（`real.itest.ts`） | 未実施（コードは用意済み） |
| 2 ログアウトでの失効、リフレッシュの回転、期限切れでのログアウト | 結合テスト AC-9、AC-12（`real.itest.ts`、`long.itest.ts`） | 未実施 |
| 3 メール確認オフ | 人間・管理画面（手順3-1）＋結合テスト AC-8 | 未実施 |
| 4 `postgres` 系ロールでの SET ROLE、接続方式、SSL | 結合テスト AC-10（最小権限ロール `ccai_app` で確認） | 未実施。**`postgres` が `grant anon, authenticated, service_role to ccai_app` できるかは公式ドキュメントで未確認**（マイグレーション2の実行時に分かる） |
| 5 新しい表の既定権限 | 結合テスト AC-10（権限一覧）、Data API の無効化は人間・管理画面 | 未実施 |
| 6 削除の連鎖、バックアップの保存場所 | 結合テスト AC-11。バックアップは Free プランでは自動バックアップなしのため「該当なし」 | 未実施 |
| 7 Vercel でのビルド、環境変数 | 人間・管理画面（手順9）、コード確認（NEXT_PUBLIC_ なし） | 未実施 |
| 8 HTTPS の cookie | 結合テスト AC-16、人間（手順11-4） | 未実施 |
| 9〜12 iPhone・PC の実機 | 人間・画面（手順11〜12） | 未実施 |

### 12-3. 公式ドキュメントでの確認（確認日 2026-10-07）と、未確認のまま残る点
出典は docs/reviews/spec-review-SPEC-000c-v1.md の表を参照。

確認できた: Vercel Hobby は単一地域を指定でき、`vercel.json` の `regions` で指定する。Supabase の Data API は「Enable Data API」で無効にできる。プーラーは IPv4 対応（GitHub Actions 向け）。Supabase Free は無活動で一時停止し、Resume project で再開できる。GitHub Free の非公開リポジトリの Actions は月2,000分で、支払い方法がなければ枠を使い切ると止まる。

未確認: `postgres` ロールによる `ccai_app` への `anon`／`authenticated`／`service_role` の付与、メール確認オフ時の重複登録の応答コード、リフレッシュトークンの再利用猶予（既定10秒と想定）、`hnd1` の表記と `x-vercel-id` の形式、SQL Editor が複数文の最後の結果を表示するか、Vercel の Deployment Protection の既定、Vercel・Supabase でのクレジットカード要否、新しいキー表記（publishable／secret）での動作、Vercel のログ保持（Hobby は1時間と記載。相談本文のログの確認は SPEC-001）。

### 12-4. 残る注意（SPEC-001 より前に再検討）
- DB への SSL は暗号化のみで、サーバー証明書の検証をしていない（`rejectUnauthorized: false`）。Supabase の CA 証明書を設定する方式は、相談本文を保存する SPEC-001 の前に検討する。
- 結合テストは本体のプロジェクトに対して流す（D-016）。SPEC-001 の前に、テスト専用プロジェクトへ分ける。
- 最小権限ロールが使えない場合の代わり（`postgres` で接続）は、CI に管理者パスワードが入るため、人間の判断が要る（レビューの指摘）。

### 12-5. 初回の結合テスト（2026-10-08、GitHub Actions run 37705052038）の失敗と対応
- **件数の前後比較の失敗（real・site）**: 原因は並行実行ではなく（設定は直列）、テスト用アドレスの組み立て。`ciEmail` が名前（`setlocal-a`、`rest-a` など）の「-」をそのまま入れ、後片付けの判定（正規表現）に一致しなかった。そのため「テスト用以外」として数えられ、後片付けでも消えず、人間の本番プロジェクトに最大5件（setlocal-a、rest-a、rest-b、del-c、site-login）が残った可能性がある。
  - 対応: `ciEmail` が名前を英小文字・数字だけにし、作ったアドレスが判定に一致しなければ例外にする。判定の正規表現を、初回の取り残しの形（名前に「-」）も含むよう広げた（次回の開始時に自動で消える）。後片付けは、判定に加えて「この実行で作ったユーザー（ID）」も対象にし、作ったユーザーが残っていないことも確かめる。結合テストは1ファイルずつ直列（`maxWorkers: 1` を追加）。手で消す手順を手順書に追加。
- **リフレッシュトークンの再利用が拒否されなかった**: テストの期待が Supabase の仕様と違っていた。公式ドキュメント「Sessions」（確認日 2026-10-08。supabase.com は取得許可が得られず、同内容のミラー cloud.snap.com/docs/guides/auth/sessions で確認）: リフレッシュトークンは原則1回だけ。ただし (1) 再利用の猶予（既定10秒。変更は非推奨）と (2) 「いま有効なトークンの親」の再利用は、いま有効なトークンを返す。それ以外の再利用はセッション全体を失効させる（Advanced Settings で無効にできるが非推奨）。テストは「2つ以上前のトークンの再利用が拒否され、セッション全体が失効する」ことを確かめる形に直した。親の再利用が通る点は SPEC-000c AC-9 の文言との差として戦略担当に確認中。設定画面の名前（"Detect and revoke potentially compromised refresh tokens"）と既定オンは、公式ページの文言としては未確認。
- **失敗時にリフレッシュトークンの値がログに出た**: `expect(x).toBeNull()` の失敗表示が、返ってきたトークンを含むオブジェクトを出した。対応: 結合テストでは `expect` を直接使わず、真偽・数値・コードだけを渡す部品（`tests/integration/lib.ts` の `ok`／`sameNumber`／`sameCode`／`emptyLabels`）だけを使う（静的検査で強制）。さらに保険として、起動スクリプト `scripts/run-integration.mjs` が出力の各行を伏せ字にする。**伏せ字の対象は、環境変数の値（キー・DB のホストとパスワード・プロジェクトURLとID・CI_LEAK_PROBE）、テスト用パスワード、JWT の形（アクセストークン）、`sb_secret_`／`sb_publishable_` の形のキー、メールアドレス、`refresh_token: …` のように名前つきで出た値だけ。名前なしで出たリフレッシュトークンは形で見分けられないため伏せられない。** リフレッシュトークンは、書き方の規則（トークンを `ok` などの説明文・テンプレート文字列・`Error` に入れない。静的検査で強制。QA v2 の L-1）で守る。ワークフローが起動スクリプト経由で実行することも静的検査で確かめる（L-2）。出てしまったトークンは、テスト用ユーザーの削除で無効になっている。

### 12-6. 再利用の検知の実際の動作（2026-10-09。結合テスト run 37746491893 の残り1件の失敗）
一次情報: 公開リポジトリ supabase/auth（GoTrue）。`git clone --depth 1` で取得し、コミット `ce9a8eee0cc042be8c7a42981a7ddae631e41d91`（2026-09-22）を読んだ。**Supabase のクラウドで実際に動いている版・設定値（下の `RefreshTokenAlgorithmVersion` など）は公開されていないので未確認。** 結合テストの結果はこのソースの「旧形式」の動作と一致する。

リフレッシュトークンの形式は2つある（`internal/models/user.go` の `FindUserWithRefreshToken`、720〜731行）: 12文字なら旧形式（DB の `refresh_tokens` の行）、それより長ければ新形式（セッションの番号つきの署名トークン）。

**旧形式（`internal/tokens/service.go` の `RefreshTokenGrant`、375〜408行）**
- 使用済み（revoked）のトークンが来たら、まず「いま有効なトークン」（`Session.FindCurrentlyActiveRefreshToken`。`internal/models/sessions.go` 428〜440行。同じセッションの revoked でない最新の行）の親かを見る。親なら、いま有効なトークンを返す（382〜390行）。
- 親でなければ、そのトークンの `updated_at` から再利用の猶予（`RefreshTokenReuseInterval`、既定10秒）以内なら**通す**（新しいトークンを発行）。猶予を過ぎていれば、`RefreshTokenRotationEnabled`（既定 true。画面の「Detect and revoke potentially compromised refresh tokens」に当たると考えられるが、画面名との対応は未確認）のとき `models.RevokeTokenFamily` を呼び、`refresh_token_already_used` を返す（393〜408行）。
- `RevokeTokenFamily`（`internal/models/refresh_token.go` 87〜109行）は、**同じセッションのまだ失効していない全リフレッシュトークンを `revoked = true, updated_at = now()` にする**。セッションの行は消さない。
- その結果: いま有効だったトークンも失効するが、`updated_at` がその瞬間に更新されるため、**検知から10秒以内にそのトークンを使うと、上の「猶予以内なら通す」に当たって新しいトークンが発行される**。10秒を過ぎてから使えば拒否される（そのときにもう一度、全体が失効する）。また、セッションの行は残るので、**発行済みのアクセストークン（最長1時間）は、期限まで使える**。

**新形式（同じ関数の 485〜584行）**
- トークンに番号（counter）があり、セッションの最新の番号との差で判断する。差が1（親）か、最後の更新から猶予以内なら通す。それ以外は `RefreshTokenRotationEnabled` のとき `models.LogoutSession`（`internal/models/sessions.go` 363〜365行。**セッションの行を削除**）で、いま有効なトークンもアクセストークンも、即座に使えなくなる。
- どちらの形式が使われるかは `RefreshTokenAlgorithmVersion` と `RefreshTokenUpgradePercentage`（`internal/conf/configuration.go` 927〜931行）による。クラウドの値は未確認。

**結合テストの手順との突き合わせ**（`real.itest.ts` の「2つ以上前のトークンの再利用」）: ログイン（t1）→ 更新（r2）→ 13秒待って更新（r3）→ 13秒待って t1 を再利用 → **すぐに** r3 で更新。
- t1 の再利用: t1 は r3 の親ではなく（r3 の親は r2）、t1 の失効から10秒以上たっているので拒否され、全体が失効する（テストの期待どおり。成功）。
- 直後の r3 での更新: 旧形式では r3 の `updated_at` がたった今の失効時刻なので、猶予の10秒以内として**通る**。これが「いま有効だったトークンも失効: expected false to be true」の理由。新形式なら拒否されるはずなので、このプロジェクトでは旧形式（12文字のトークン）が使われていると推定する（トークンの長さは記録していないので未確定）。
- ログアウト（`/logout`、scope global）は `models.Logout`（同 358〜360行。ユーザーの全セッションの行を削除）なので、形式によらず全トークンが即座に使えなくなる（Q-1 のテストが成功したことと一致）。

**SPEC との差**: SPEC-000c v2 AC-9「そのうえでセッション全体が失効し、いま有効なトークンでも更新できなくなる」は、旧形式では「検知の直後10秒間は、いま有効だったトークンで更新できる」「アクセストークンは期限まで使える」という点で文字どおりには成り立たない。テストは緩めず、戦略担当に確認中（開発担当の返答を参照）。
