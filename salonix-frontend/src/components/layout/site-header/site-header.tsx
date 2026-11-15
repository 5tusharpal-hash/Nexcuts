import Link from "next/link";

export function SiteHeader() {
  return (
    <header className="site-header">
      <Link className="site-logo" href="/">
        Salonix
      </Link>
      <nav aria-label="Main navigation">
        <Link href="/login">Sign in</Link>
        <Link href="/register">Create account</Link>
      </nav>
    </header>
  );
}
