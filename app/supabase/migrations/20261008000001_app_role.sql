-- SPEC-000c: アプリ用の最小権限DBロール（QA 軽微 A-6）。
-- アプリと結合テストは、このロールで接続する。テーブル権限も BYPASSRLS も持たない。
-- できること: anon / authenticated / service_role への SET ROLE だけ（アプリは必ず SET LOCAL ROLE をしてから表を読み書きする。
--             し忘れた処理は「権限エラー」で失敗し、分離なしでは動かない）。
-- パスワードはこのSQLに書かない。適用後に supabase/manual/set-app-role-password.sql を実行して、人間が設定する（docs/runbooks/deploy-personal.md）。
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'ccai_app') then
    create role ccai_app login noinherit nosuperuser nocreatedb nocreaterole nobypassrls;
  end if;
end $$;

-- noinherit: 3つのロールの権限は引き継がない（SET ROLE したときだけ、そのロールの権限で動く）
grant anon, authenticated, service_role to ccai_app;
