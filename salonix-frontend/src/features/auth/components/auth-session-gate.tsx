"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { restoreSession } from "@/features/auth/services/auth.service";
import { getAccessToken } from "@/lib/auth/access-token";

export function AuthSessionGate({ children }: Readonly<{ children: React.ReactNode }>) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (getAccessToken()) {
      setReady(true);
      return;
    }

    restoreSession()
      .then(() => setReady(true))
      .catch(() => {
        const next = `${window.location.pathname}${window.location.search}`;
        router.replace(`/login?next=${encodeURIComponent(next)}`);
      });
  }, [router]);

  if (!ready) return null;
  return children;
}
