// 結合テストの後片付け（GitHub Actions の if: always() のステップ）。タイムアウト・キャンセルで vitest の後片付けが動かなかったときのため。
// 決まった形のアドレス（ccai-ci+<実行ID>-<名前>@example.invalid。名前は英小文字・数字と「-」）のユーザーだけを、管理APIで削除する（DB側の行は連鎖で消える）。
// 値（アドレス・キー）は出力しない。件数だけを出す。
import { createClient } from "@supabase/supabase-js";

// tests/integration/lib.ts の CI_EMAIL_RE と同じ（static-checks が一致を確かめる）
const CI_EMAIL_RE = /^ccai-ci\+[a-z0-9]+-[0-9a-z]+(?:-[0-9a-z]+)*@example\.invalid$/;

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.log("[ci-cleanup] 設定がないため、何もしません");
  process.exit(0);
}
const admin = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
let found = 0;
let failed = 0;
for (let page = 1; page < 100; page++) {
  const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
  if (error) {
    console.log("[ci-cleanup] 一覧の取得に失敗しました");
    process.exit(1);
  }
  for (const u of data.users) {
    if (!CI_EMAIL_RE.test(u.email ?? "")) continue;
    found++;
    const r = await admin.auth.admin.deleteUser(u.id);
    if (r.error) failed++;
  }
  if (data.users.length < 200) break;
}
console.log(`[ci-cleanup] テスト用ユーザー ${found} 件を対象に、削除に失敗 ${failed} 件`);
process.exit(failed ? 1 : 0);
