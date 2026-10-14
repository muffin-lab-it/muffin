"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "홈", icon: "🏠" },
  { href: "/history", label: "저장함", icon: "🔖" },
];

/** 공통 사이드바. 콘셉트의 AI스토리·설정·Pro 는 범위 밖이라 넣지 않습니다. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <aside className="sidebar">
      <Link href="/" className="brand">🧁 Muffin Lab</Link>
      <nav>
        {items.map((it) => {
          const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href} className={active ? "nav-item active" : "nav-item"}>
              <span aria-hidden>{it.icon}</span> {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
