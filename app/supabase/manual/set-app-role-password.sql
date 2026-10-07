-- アプリ用ロール ccai_app のパスワードを、DBの中で作って設定し、結果の画面に1回だけ表示する。
-- 表示された値を、パスワード管理の場所と、Vercel・GitHub の秘密情報（DB_PASSWORD）にコピーする。チャット・メモ・スクリーンショットには貼らない。
-- もう一度実行すると新しいパスワードに変わる（古いものは使えなくなる）。漏らしたかもしれないときも、これを実行し直す。
create or replace function pg_temp.ccai_set_app_password() returns text
language plpgsql as $$
declare
  pw text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  execute format('alter role ccai_app with password %L', pw);
  return pw;
end $$;

select pg_temp.ccai_set_app_password() as "ccai_app_password__copy_this_once";
