import { BRAND } from "./src/config/brand.ts";

export interface CapacitorProjectConfig {
  appId: string;
  appName: string;
  webDir: string;
  server?: {
    androidScheme: "https";
  };
  plugins?: Record<string, Record<string, unknown>>;
}

const config: CapacitorProjectConfig = {
  appId: `app.${BRAND.slug}.mobile`,
  appName: BRAND.appName,
  webDir: "dist",
  server: {
    androidScheme: "https",
  },
  plugins: {
    SplashScreen: {
      launchAutoHide: true,
      backgroundColor: "#F2F2F7",
    },
  },
};

export default config;
