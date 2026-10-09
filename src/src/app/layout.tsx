import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Aéro Service | Gestion",
  description: "Plateforme de gestion des formations, des apprenants et des opérations Aéro Service.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="fr"><body>{children}</body></html>;
}
