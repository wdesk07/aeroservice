import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    id: "/",
    name: "Aéro Service",
    short_name: "Aéro Service",
    description: "Plateforme de gestion Aéro Service",
    start_url: "/",
    scope: "/",
    display: "standalone",
    orientation: "any",
    lang: "fr",
    background_color: "#ffffff",
    theme_color: "#123b63",
    icons: [
      {
        src: "/aero-service-logo.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any"
      }
    ]
  };
}
