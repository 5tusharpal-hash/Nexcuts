import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Overview",
};

export default function DashboardPage() {
  return (
    <section className="dashboard-placeholder">
      <h1>Dashboard</h1>
      <p>Your authenticated Salonix workspace will be built here.</p>
    </section>
  );
}
