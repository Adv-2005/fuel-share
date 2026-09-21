import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "FuelShare",
    short_name: "FuelShare",
    description: "Shared scooter petrol and repayment tracker",
    start_url: "/",
    display: "standalone",
    background_color: "#f7f3e9",
    theme_color: "#173f35",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
