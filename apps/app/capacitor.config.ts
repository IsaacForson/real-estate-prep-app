import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.forsare.realestateprep",
  appName: "Real Estate Exam Prep",
  // `nuxt generate` writes the static client build here.
  webDir: ".output/public",
  server: { androidScheme: "https" },
  plugins: {
    // The app hides the splash itself once `auth.ready` flips (app/plugins/native.client.ts), so the
    // first frame after it is the real destination rather than a blank shell.
    SplashScreen: {
      launchAutoHide: false,
      launchShowDuration: 0,
      backgroundColor: "#141210",
      androidSpinnerStyle: "large",
      spinnerColor: "#8a8178",
      showSpinner: true,
    },
  },
  ios: { contentInset: "automatic" },
};

export default config;
