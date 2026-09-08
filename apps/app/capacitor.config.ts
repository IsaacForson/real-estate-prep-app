import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.forsare.realestateprep",
  appName: "Real Estate Exam Prep",
  // `nuxt generate` writes the static client build here.
  webDir: ".output/public",
  server: { androidScheme: "https" },
  ios: { contentInset: "automatic" },
};

export default config;
