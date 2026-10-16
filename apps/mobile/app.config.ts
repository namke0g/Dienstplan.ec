import type { ExpoConfig } from "expo/config";

// EXPO_PUBLIC_API_URL: base URL of the deployed web app, e.g. https://dienstplan.example.de
// EXPO_PUBLIC_EAS_PROJECT_ID: from `eas init`; required for push tokens on real builds
const config: ExpoConfig = {
  name: "Dienstplan",
  slug: "dienstplan",
  scheme: "dienstplan",
  version: "0.1.0",
  orientation: "portrait",
  userInterfaceStyle: "automatic",
  ios: { bundleIdentifier: "de.dienstplan.app", supportsTablet: true },
  android: { package: "de.dienstplan.app" },
  plugins: [
    "expo-router",
    "expo-secure-store",
    ["expo-notifications", { color: "#2563eb", defaultChannel: "default" }],
  ],
  experiments: { typedRoutes: true },
  extra: { eas: { projectId: process.env.EXPO_PUBLIC_EAS_PROJECT_ID } },
};
export default config;
