-- テスト用の Supabase 互換物（shim）。本物の Supabase が用意する「前提」だけを最小限で再現する。
-- 再現するもの: ロール anon / authenticated / service_role(RLS迂回)、スキーマ auth、auth.users（id, email のみ）、auth.uid()、
--               public スキーマの新規テーブルに anon / authenticated / service_role へ全権限を付ける既定（Supabase と同じ。マイグレーションが取り消す）。
-- 再現しないもの（本物との差）は docs/architecture.md の「テストの shim と本物の差」に記録している。
create role anon nologin noinherit;
create role authenticated nologin noinherit;
create role service_role nologin noinherit bypassrls;

create schema auth;
create table auth.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  created_at timestamptz not null default now()
);

create function auth.uid() returns uuid
language sql stable as $$
  select coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant execute on function auth.uid() to anon, authenticated, service_role;
grant all on all tables in schema auth to service_role;

alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
