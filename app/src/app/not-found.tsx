import Link from "next/link";

export default function NotFound() {
  return (
    <div>
      <h1>ページが見つかりません</h1>
      {/* ホームは、未ログインならログイン画面へ移る */}
      <Link href="/" className="btn primary">
        ホームへ
      </Link>
    </div>
  );
}
