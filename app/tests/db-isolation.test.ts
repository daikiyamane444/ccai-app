// AC-9・AC-10・AC-11: 他人・連携相手・匿名から、プロフィールを読めない／変更・削除できない（データ層を直接呼ぶテスト）
import { defineIsolationTests } from "./helpers/isolation";

// 個人データの種類を1つ追加するときは、このように数行を足す（app/README.md「個人データを追加する手順」3）
defineIsolationTests({
  name: "プロフィール",
  table: "public.profiles",
  ownerColumn: "user_id",
  idColumn: "user_id",
  seed: async (admin, ownerId) => {
    await admin.query("INSERT INTO public.profiles (user_id, display_name, age_confirmed_at) VALUES ($1, '本人の名前', now())", [ownerId]);
    return ownerId;
  },
  update: { set: "display_name = '乗っ取り'" },
  insertForOwnerSql: "INSERT INTO public.profiles (user_id, display_name, age_confirmed_at) VALUES ($1, '偽造', now())",
  ownerCanRead: true,
});
