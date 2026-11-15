import type { Metadata } from "next";
import { DashboardSidebar } from "@/components/layout/dashboard-sidebar/dashboard-sidebar";
import { AuthSessionGate } from "@/features/auth/components/auth-session-gate";

export const metadata: Metadata = {
  title: {
    absolute: "Salonix Dashboard",
  },
};

export default function DashboardLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <AuthSessionGate>
      <div className="dashboard-shell">
        <DashboardSidebar />
        <main className="dashboard-content">{children}</main>
      </div>
    </AuthSessionGate>
  );
}
