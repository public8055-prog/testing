"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Menu, X, ShoppingBag, House } from "lucide-react";
import { isAdminRole } from "@/lib/roles";
import { ThemeToggle } from "./theme-toggle";
import { useCart } from "@/lib/cart-store";
import { CartDrawer } from "./cart-drawer";
import { useAccountSession } from "./session-provider";

const links = [
  { href: "/services", label: "Services" },
  { href: "/how-it-works", label: "How it works" },
  { href: "/for-businesses", label: "For businesses" },
  { href: "/become-a-provider", label: "Become a provider" },
];

/** "Asha Rani" -> { firstName: "Asha", initials: "AR" } — used for the signed-in header chip. */
function nameParts(fullName: string) {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  return { firstName: parts[0] || "Account", initials: parts.slice(0, 2).map(part => part[0]).join("").toUpperCase() || "U" };
}

export function Header() {
  const pathname = usePathname();
  const [menuPath, setMenuPath] = useState<string | null>(null);
  const [cartOpen, setCartOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const header = useRef<HTMLElement>(null);
  const menuToggle = useRef<HTMLButtonElement>(null);
  const { user, loading } = useAccountSession();
  const count = useCart(s => s.lines.reduce((sum, line) => sum + line.qty, 0));
  const open = menuPath === pathname;
  const accountHref = user && isAdminRole(user.role) ? "/admin/dashboard" : "/dashboard";
  const name = user ? nameParts(user.name) : null;
  const accountLink = user ? { href: accountHref, label: `${name!.firstName}'s account` } : { href: "/login", label: "Log in" };

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (event.target instanceof Node && !header.current?.contains(event.target)) setMenuPath(null); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setMenuPath(null); menuToggle.current?.focus(); } };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);

  return <>
    <a href="#main-content" className="skip-link">Skip to content</a>
    <header ref={header} className={`site-header${scrolled ? " site-header-scrolled" : ""}`}>
      <div className="uk-shell header-inner">
        <Link href="/" aria-label="UrbanKare home" className="brand" onClick={() => setMenuPath(null)}><span className="brand-mark"><House size={23} aria-hidden="true" /><span /></span><span>urban<span className="brand-light">kare</span><span className="brand-period">.</span></span></Link>
        <nav aria-label="Main navigation" className="desktop-nav">{links.map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined}>{link.label}</Link>)}</nav>
        <div className="header-actions"><ThemeToggle/>
          <button type="button" aria-label={count > 0 ? `Open cart, ${count} items` : "Open cart"} onClick={() => { setMenuPath(null); setCartOpen(true); }} className="cart-toggle"><ShoppingBag size={21} aria-hidden="true" />{count > 0 && <span aria-hidden="true">{count > 99 ? "99+" : count}</span>}</button>
          {loading && !user ? <span className="header-login account-session-loading" aria-label="Checking account"><span /></span> : user
            ? <Link href={accountHref} className="header-login account-chip" aria-label={`Account: ${user.name}`}><span className="account-avatar" aria-hidden="true">{name!.initials}</span><span className="account-name">{name!.firstName}</span></Link>
            : <Link href="/login" className="header-login">Log in <ArrowUpRight size={14} aria-hidden="true" /></Link>}
          <Link href="/services" className="uk-button header-book">Book a service <ArrowUpRight size={15} aria-hidden="true" /></Link>
          <button ref={menuToggle} type="button" aria-label={open ? "Close navigation" : "Open navigation"} aria-expanded={open} aria-controls="mobile-more-navigation" onClick={() => setMenuPath(open ? null : pathname)} className="mobile-toggle">{open ? <X size={23} aria-hidden="true" /> : <Menu size={23} aria-hidden="true" />}</button>
        </div>
      </div>
      <nav id="mobile-more-navigation" aria-label="More navigation" className="mobile-nav" hidden={!open}>
        <p className="mobile-nav-heading">A little help, every day</p>
        {[...links, { href: "/contact", label: "Contact & support" }, ...(!loading || user ? [accountLink] : [])].map(link => <Link key={link.href} href={link.href} aria-current={pathname === link.href ? "page" : undefined} onClick={() => setMenuPath(null)}>{link.label}<ArrowUpRight size={16} aria-hidden="true" /></Link>)}
      </nav>
    </header>
    <CartDrawer open={cartOpen} onClose={() => setCartOpen(false)} />
  </>;
}
