# CCAI 開発ハーネス

AIカップルカウンセラーアプリを、4つのAI担当で開発するための Claude Code プロジェクト構成。

```
人間 ──/intake──▶ 問い合わせ担当（メインセッション / CLAUDE.md）
                     │
                     ├─▶ strategist（戦略）      戦略更新・SPEC作成
                     │        ▲ 要調整（最大3往復）
                     │        ▼
                     ├─▶ developer（開発）       ①SPECレビュー ②実装・テスト
                     │
                     └─▶ quality-reviewer（品質）システム／仕様／戦略・設計の3観点で検収
                              │
                     合格 → 人間が画面確認・承認 → デプロイ
                     差し戻し → 宛先（strategist / developer）からやり直し
```

## 使い方

1. フォルダで `claude` を起動する（CLAUDE.md とサブエージェントが自動で読み込まれる）。
2. 要望や変更は `/intake <内容>` で渡す。進捗は `docs/cycles.md`、決定は `docs/decisions.md`。
3. 次の一手（2026-10-07 時点）：`/intake SPEC-000（技術基盤）を作成して、技術選定案を出して`
   → developer が `docs/architecture.md` に選定案を書く → 人間が承認 → 実装に進む。

根拠資料3本は `docs/sources/` に配置済み。優先5問（Q-S1〜S3, Q-H8, Q-H9）は D-003〜D-007 で決定済み。

## ファイル

| パス | 内容 | 管理者 |
| --- | --- | --- |
| CLAUDE.md | 問い合わせ担当の指示・サイクル・人間確認の条件 | 人間 |
| .claude/agents/strategist.md | 戦略担当 | 人間 |
| .claude/agents/developer.md | 開発担当（レビュー/実装モード） | 人間 |
| .claude/agents/quality-reviewer.md | 品質担当（コード編集不可） | 人間 |
| .claude/commands/intake.md | `/intake` コマンド | 人間 |
| .claude/settings.json | 権限の制限（秘密情報の読み取り・公開系コマンドの禁止） | 人間 |
| .gitignore | git管理から外すもの（.env など） | 人間 |
| docs/strategy/strategy.md | 戦略（v1、MVP決定済み） | strategist |
| docs/specs/ | 開発仕様 SPEC-xxx | strategist |
| docs/decisions.md | 人間の決定だけ | strategist（人間の決定を記録） |
| docs/open-questions.md | 未決事項（要件整理 第5章ベース） | strategist |
| docs/architecture.md | 技術選定（SPEC-000で作成。人間の承認が必要） | developer |
| docs/reviews/ | 仕様レビュー・検収レポート・評価用会話例 | developer / quality-reviewer |
| docs/reviews/eval-runs/ | 実LLMでの評価結果（手動実行） | developer / quality-reviewer |
| docs/inbox/ | 人間のインプット原文 | 問い合わせ担当 |
| app/ | アプリのコード | developer |

## 仮置きした運用ルール（変更可）

本依頼で未指定だった点は次のように仮決定している（open-questions Q-H1〜H4）。

- 戦略と開発が3往復で合意しなければ人間が決める
- 同じ指摘で2回差し戻されたら人間に上げる
- 最終受入とデプロイは人間の承認後
- 技術選定は SPEC-000 で人間が承認するまで実装しない（D-008）
- サイクルごとに git コミット（push はしない）
- モデル：戦略・品質は Opus、開発は Sonnet（異なるモデルで相互確認）
