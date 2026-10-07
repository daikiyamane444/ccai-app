// 利用者に見せる固定文（日本語）
export const MSG = {
  loginFailed: "メールアドレスまたはパスワードが正しくありません",
  network: "通信できませんでした。電波の良い場所でもう一度お試しください",
  notConfigured: "接続先が設定されていません（開発者向け: app/README.md を参照）",
  signupClosed: "現在、新規登録を受け付けていません",
  emailTaken: "このメールアドレスは登録済みです",
  required: "入力してください",
  emailFormat: "メールアドレスの形式が正しくありません",
  passwordShort: "パスワードは8文字以上で入力してください",
  passwordLong: "パスワードは72文字以内で入力してください",
  nameLong: "表示名は20文字以内で入力してください",
  ageRequired: "18歳以上の方のみ登録できます。確認のチェックを入れてください",
  unexpected: "うまくいきませんでした。しばらくしてからもう一度お試しください",
  unauthorized: "認証が必要です",
  badRequest: "リクエストの形式が正しくありません",
} as const;
