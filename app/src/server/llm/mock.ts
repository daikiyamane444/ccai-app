/**
 * モックのアダプタ（自動テスト・試走・接続先なしのローカル起動）。外部に通信しない。
 * プロンプト名ごとに固定の応答を返す。テストから応答・失敗・遅延を指定できる。
 */
import { AdapterError, type AdapterErrorKind, type AdapterRequest, type AdapterResponse, type LlmAdapter } from "./types";

export type MockBehavior = { text?: string; error?: AdapterErrorKind; delayMs?: number; inputTokens?: number; outputTokens?: number };

/** プロンプト名ごとの固定応答（既定） */
export const MOCK_RESPONSES: Record<string, string> = {
  _sample: "（モックの応答）受け取った文を短く言い換えました。",
};

export class MockAdapter implements LlmAdapter {
  readonly mode = "mock" as const;
  public calls = 0;
  private queue: MockBehavior[] = [];
  constructor(private behaviors: Record<string, MockBehavior> = {}) {}

  /** 次の呼び出しの振る舞いを順に指定する（テスト用） */
  enqueue(...b: MockBehavior[]) {
    this.queue.push(...b);
  }

  async generate(req: AdapterRequest): Promise<AdapterResponse> {
    this.calls++;
    const b = this.queue.shift() ?? this.behaviors[req.promptName] ?? {};
    if (b.delayMs) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, b.delayMs);
        req.signal.addEventListener("abort", () => {
          clearTimeout(t);
          reject(new AdapterError("timeout"));
        });
      });
    }
    if (req.signal.aborted) throw new AdapterError("timeout");
    if (b.error) throw new AdapterError(b.error);
    const text = b.text ?? MOCK_RESPONSES[req.promptName] ?? "（モックの応答）";
    return {
      text,
      inputTokens: b.inputTokens ?? Math.ceil(([...req.system].length + [...req.input].length) / 2),
      outputTokens: b.outputTokens ?? Math.min(req.maxOutputTokens, [...text].length),
    };
  }
}
