"use client";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

export function TopBar() {
  const path = usePathname();
  const router = useRouter();
  if (path === "/login") return null;
  const link = (href: string, label: string) => (
    <Link href={href} className={path === href ? "active" : undefined}>
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
          FREEDOM EXTERIORS<small>Invoice Project</small>
        </Link>
        <nav className="nav">
          {link("/", "Catalog")}
          {link("/invoices/new", "New invoice")}
          {link("/upload", "Upload old invoice")}
        </nav>
        <button className="link" onClick={signOut}>Sign out</button>
      </div>
    </header>
  );
}
