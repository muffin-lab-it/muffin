/**
 * 모든 응답에 붙는 보안 헤더 (next.config.ts 의 headers 가 씁니다). 리더 관리.
 *
 *  - X-Frame-Options · CSP frame-ancestors: 다른 사이트가 머핀을 iframe 에 넣어 클릭을 가로채지 못하게 (admin 포함). 우리 화면은 어디에도 끼워 넣지 않습니다.
 *  - X-Content-Type-Options: 브라우저가 응답 형식을 멋대로 추측하지 않게.
 *  - Referrer-Policy: 출처 링크(FRED · ECOS 등)를 열 때 우리 주소의 경로 · 질문 id 가 넘어가지 않게 (출처만 전달).
 *  - Permissions-Policy: 카메라 · 마이크 · 위치 · 결제는 쓰지 않으니 끕니다.
 * HSTS 는 Vercel 이 붙입니다. 스크립트 · 스타일을 제한하는 CSP 는 Next 의 인라인 스크립트와 부딪혀 넣지 않았습니다 (nonce 설계가 필요).
 */
export const SECURITY_HEADERS: { key: string; value: string }[] = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];
