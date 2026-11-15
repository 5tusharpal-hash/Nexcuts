import type { Metadata, Viewport } from "next";
import { GlobalScrollbars } from "@/components/providers/global-scrollbars";
import { publicEnv } from "@/lib/env";
import "./globals.css";
import "overlayscrollbars/overlayscrollbars.css";

export const metadata: Metadata = {
  title: {
    default: "Salonix",
    template: "%s | Salonix",
  },
  description: "Salon management platform",
  metadataBase: new URL(publicEnv.NEXT_PUBLIC_APP_URL),
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <GlobalScrollbars />
        {children}
      </body>
    </html>
  );
}
