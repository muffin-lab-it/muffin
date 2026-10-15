/**
 * .env 의 *_KEY 값이 텍스트에 섞여 있으면 [REDACTED] 로 지웁니다.
 * URL 모양(쿼리·경로)에 기대지 않고 키 값 자체를 찾으므로, 키를 어디에 넣는 API 든 막힙니다.
 * 원본, URL 인코딩, 폼 인코딩 세 형태를 지웁니다. 8자 미만 값은 오탐을 막으려고 건너뜁니다.
 */
export function redactSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    if (!name.endsWith("_KEY") || !value || value.length < 8) continue;
    const forms = new Set([value, encodeURIComponent(value), new URLSearchParams({ k: value }).toString().slice(2)]);
    for (const form of forms) out = out.replaceAll(form, "[REDACTED]");
  }
  return out;
}
