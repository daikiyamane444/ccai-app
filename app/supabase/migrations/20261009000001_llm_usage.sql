-- SPEC-000b: LLM の利用記録と月次集計。
-- app/README.md「個人データを追加する手順」に従う: 所有者の列（user_id）、RLS 有効化、権限の取り消し、分離テスト、全データ削除の対象。
-- どちらの表も、利用者（anon / authenticated）は本人を含めて読み書きできない。書くのはサーバー側の特権部品（src/server/privileged/llm-usage.ts）だけ。
-- 入力文・応答文は保存しない（列を持たない）。

-- ============ LLM 利用記録（所有者: user_id。評価コマンドの実行分は「システム」所有 = is_system かつ user_id なし） ============
create table public.llm_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete cascade,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  prompt_name text not null check (prompt_name ~ '^[a-z0-9_-]{1,64}$' or prompt_name = '(invalid)'),
  mode text not null check (mode in ('mock', 'plan')),
  model text not null check (char_length(model) between 1 and 100),
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),
  estimated_cost_jpy numeric(14, 4) not null default 0 check (estimated_cost_jpy >= 0),
  reserved_cost_jpy numeric(14, 4) not null default 0 check (reserved_cost_jpy >= 0),
  -- 結果: 成功 / 失敗 / タイムアウト / 上限超過 / 設定不足。pending は「呼び出し中」の一時的な状態（呼び出しの完了時に5種類のどれかに更新する）
  result text not null check (result in ('pending', 'success', 'failure', 'timeout', 'limit_exceeded', 'config_missing')),
  -- エラーの種類（コードだけ。本文を含めない）
  error_kind text check (error_kind is null or error_kind ~ '^[a-z0-9_]{1,40}$'),
  -- 1日の回数に数えるか（プロバイダへ送った呼び出しだけ。システム分は数えない）
  counted boolean not null default false,
  check ((is_system and user_id is null) or (not is_system and user_id is not null)),
  check (not (is_system and counted))
);
create index llm_usage_user_day_idx on public.llm_usage (user_id, created_at) where counted;

-- ============ 月次集計（D-012。ユーザーを特定する項目を持たない。削除の対象外） ============
create table public.llm_monthly (
  month text primary key check (month ~ '^[0-9]{4}-[0-9]{2}$'), -- 日本時間の年月
  confirmed_cost_jpy numeric(16, 4) not null default 0 check (confirmed_cost_jpy >= 0),
  reserved_cost_jpy numeric(16, 4) not null default 0 check (reserved_cost_jpy >= 0),
  provider_calls integer not null default 0 check (provider_calls >= 0)
);

-- ============ 分離: RLS を有効にし、利用者向けの権限をすべて取り消す（ポリシーは作らない = 本人も読めない） ============
alter table public.llm_usage enable row level security;
alter table public.llm_monthly enable row level security;
revoke all on table public.llm_usage, public.llm_monthly from anon, authenticated;
revoke all on sequence public.llm_usage_id_seq from anon, authenticated;
