-- SPEC-000a: 基盤のデータ（プロフィール、連携 pair の器）と、行レベルセキュリティ（RLS）による分離。
-- 前提（Supabase が用意するもの）: スキーマ auth、テーブル auth.users、関数 auth.uid()、ロール anon / authenticated / service_role。
-- テストでは tests/shim/supabase-shim.sql が同じ名前の最小の互換物を作る。
-- 個人データのテーブルを足すときは app/README.md「個人データを追加する手順」に従う（RLS有効化・権限の取り消し・ポリシー・テスト・削除対象）。

-- ============ プロフィール（所有者: user_id） ============
create table public.profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) between 1 and 20),
  age_confirmed_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ============ 連携（pair）の器。最小制約は SPEC-000a 第5章（SPEC-003 で変えてよい） ============
create table public.pairs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'active' check (status in ('active', 'ended')),
  created_at timestamptz not null default now()
);

create table public.pair_members (
  pair_id uuid not null references public.pairs (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  primary key (pair_id, user_id)
);
create index pair_members_user_id_idx on public.pair_members (user_id);

-- 制約1: メンバーは最大2人。制約2: 1人が同時に所属できる active の pair は1つ。
-- 同時に登録されても破れないよう、利用者と pair ごとにトランザクション内の排他ロックを取る。
create function public.enforce_pair_member_rules() returns trigger
language plpgsql as $$
declare
  member_count int;
  pair_status text;
begin
  perform pg_advisory_xact_lock(hashtextextended('pair_user:' || new.user_id::text, 0));
  perform pg_advisory_xact_lock(hashtextextended('pair:' || new.pair_id::text, 0));

  select status into pair_status from public.pairs where id = new.pair_id;
  select count(*) into member_count from public.pair_members where pair_id = new.pair_id;
  if member_count >= 2 then
    raise exception 'pair_full: a pair can have at most 2 members' using errcode = '23514';
  end if;

  if pair_status = 'active' and exists (
    select 1
      from public.pair_members m
      join public.pairs p on p.id = m.pair_id
     where m.user_id = new.user_id and p.status = 'active' and m.pair_id <> new.pair_id
  ) then
    raise exception 'user_already_in_active_pair' using errcode = '23505';
  end if;
  return new;
end $$;

create trigger pair_members_rules
  before insert on public.pair_members
  for each row execute function public.enforce_pair_member_rules();

-- 所属は付け替えない（解消は status を ended にする）
create function public.forbid_pair_member_update() returns trigger
language plpgsql as $$
begin
  raise exception 'pair_members rows are immutable' using errcode = '23514';
end $$;

create trigger pair_members_immutable
  before update on public.pair_members
  for each row execute function public.forbid_pair_member_update();

-- ended → active に戻すときも、メンバーが他の active に入っていないことを確かめる
create function public.enforce_pair_reactivation() returns trigger
language plpgsql as $$
declare
  m record;
begin
  if new.status = 'active' and old.status <> 'active' then
    for m in select user_id from public.pair_members where pair_id = new.id order by user_id loop
      perform pg_advisory_xact_lock(hashtextextended('pair_user:' || m.user_id::text, 0));
    end loop;
    if exists (
      select 1
        from public.pair_members a
        join public.pair_members b on b.user_id = a.user_id and b.pair_id <> a.pair_id
        join public.pairs p on p.id = b.pair_id
       where a.pair_id = new.id and p.status = 'active'
    ) then
      raise exception 'user_already_in_active_pair' using errcode = '23505';
    end if;
  end if;
  return new;
end $$;

create trigger pairs_reactivation
  before update of status on public.pairs
  for each row execute function public.enforce_pair_reactivation();

-- ============ 分離（RLS）と権限 ============
alter table public.profiles enable row level security;
alter table public.pairs enable row level security;
alter table public.pair_members enable row level security;

-- Supabase は新しいテーブルに anon / authenticated へ全権限を既定で付ける。ここで一度すべて取り消し、必要なものだけ与える。
revoke all on table public.profiles, public.pairs, public.pair_members from anon, authenticated;

-- プロフィール: 本人は読める・作れる・表示名だけ更新できる（age_confirmed_at は変えられない）。削除は全データ削除の処理だけ。
grant select, insert on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));
create policy profiles_insert_own on public.profiles
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy profiles_update_own on public.profiles
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- pair: 000a では画面・APIからの作成・変更なし。当事者が自分の所属と pair の行だけ読める（相手の個人データは一切読めない）。
grant select on public.pair_members, public.pairs to authenticated;

create policy pair_members_select_own on public.pair_members
  for select to authenticated using (user_id = (select auth.uid()));
create policy pairs_select_member on public.pairs
  for select to authenticated using (
    exists (select 1 from public.pair_members m where m.pair_id = pairs.id and m.user_id = (select auth.uid()))
  );
