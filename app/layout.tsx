import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Muffin Lab",
  description: "내가 궁금한 것부터, 내가 이해할 수 있는 깊이로.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>{children}</body>
    </html>
  );
}
