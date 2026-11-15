"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogOut } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { logout } from "@/features/auth/services/auth.service";

export function DashboardSidebar() {
  const router = useRouter();
  const [error, setError] = useState<string>();
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setError(undefined);
    setIsSigningOut(true);
    try {
      await logout();
      router.replace("/login");
      router.refresh();
    } catch (signOutError) {
      setError(signOutError instanceof Error ? signOutError.message : "Unable to sign out");
    } finally {
      setIsSigningOut(false);
    }
  }

  return (
    <aside className="dashboard-sidebar">
      <strong>Salonix</strong>
      <nav aria-label="Dashboard navigation">
        <Link href="/dashboard">Overview</Link>
      </nav>
      {error && <Alert variant="error"><AlertDescription>{error}</AlertDescription></Alert>}
      <Button
        type="button"
        variant="outline"
        onClick={handleSignOut}
        disabled={isSigningOut}
        aria-label="Log out of Salonix"
      >
        {!isSigningOut && <LogOut aria-hidden="true" />}
        {isSigningOut ? "Logging out..." : "Log out"}
      </Button>
    </aside>
  );
}
