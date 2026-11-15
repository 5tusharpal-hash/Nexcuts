import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Account",
};

export default function AuthLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1fr_520px]">
      <section className="hidden flex-col justify-between bg-inverse p-12 text-text-inverse lg:flex">
        <div className="text-xl font-semibold">Salonix</div>
        <div className="max-w-lg">
          <p className="text-4xl font-semibold leading-tight">
            One workspace for bookings, customers and your salon team.
          </p>
          <p className="mt-4 text-sm text-[var(--text-inverse-muted)]">
            Public, authentication and protected application areas stay separated for security and scalability.
          </p>
        </div>
        <p className="text-xs text-[var(--text-inverse-muted)]">Salon operations, simplified.</p>
      </section>
      <section className="flex items-center justify-center bg-surface-muted p-6 sm:p-10">
        {children}
      </section>
    </main>
  );
}
