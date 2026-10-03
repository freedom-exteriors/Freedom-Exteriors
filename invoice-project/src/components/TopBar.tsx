"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function TopBar() {
  const path = usePathname();
  const router = useRouter();
  if (path === "/login") return null;
  const link = (href: string, label: string) => (
    <Link href={href} className={(href === "/" ? path === "/" || path.startsWith("/invoices/") && path !== "/invoices/new" : path.startsWith(href)) ? "active" : undefined}>
      {label}
    </Link>
  );
  async function signOut() {
    await fetch("/api/logout", { method: "POST" });
    router.replace("/login");
  }
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Link href="/" className="brand">
          FREEDOM EXTERIORS<small>Invoices &amp; Estimates</small>
        </Link>
        <nav className="nav">
          {link("/", "Invoices")}
          {link("/invoices/new", "New invoice")}
          {link("/upload", "Upload old")}
          {link("/estimates", "Estimates")}
          {link("/price-book", "Price book")}
        </nav>
        <button className="link" onClick={signOut}>Sign out</button>
      </div>
    </header>
  );
}
