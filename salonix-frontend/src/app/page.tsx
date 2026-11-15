import Link from "next/link";
import { SiteHeader } from "@/components/layout/site-header/site-header";

export default function HomePage() {
  return (
    <div className="public-site">
      <SiteHeader />
      <main className="public-page">
        <section className="hero">
        <span className="eyebrow">Salon management, simplified</span>
        <h1>Run every part of your salon with Salonix</h1>
        <p>
          Manage bookings, customers, staff, services and business operations
          from one focused workspace.
        </p>
        <div className="hero-actions">
          <Link className="button button-primary" href="/register">
            Get started
          </Link>
          <Link className="button button-secondary" href="/login">
            Sign in
          </Link>
        </div>
        </section>
      </main>
    </div>
  );
}
