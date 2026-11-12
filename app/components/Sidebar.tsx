"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "홈" },
  { href: "/history", label: "보관함" },
];

/** Shared top navigation. Retains the existing export for the root layout. */
export function Sidebar() {
  const pathname = usePathname();
  return (
    <header className="muffin-gnb">
      <Link href="/" className="muffin-brand"><Image src="/icon.svg" alt="" width={38} height={38} /> Muffin Lab <small>쉽게 배우는 금융</small></Link>
      <nav aria-label="주 메뉴">
        {items.map((it) => {
          const active = it.href === "/" ? pathname === "/" : pathname.startsWith(it.href);
          return (
            <Link key={it.href} href={it.href} className="muffin-nav-link" aria-current={active ? "page" : undefined}>
              {it.label}
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
