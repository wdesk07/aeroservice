import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aéro Service | Gestion",
  description: "Plateforme de gestion des formations, des apprenants et des opérations Aéro Service.",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/aero-service-logo.svg", apple: "/aero-service-logo.svg" },
  appleWebApp: {
    capable: true,
    title: "Aéro Service",
    statusBarStyle: "default",
  },
};

export const viewport: Viewport = {
  themeColor: "#123b63",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
