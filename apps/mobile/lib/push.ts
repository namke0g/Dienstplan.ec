import * as Device from "expo-device";
import * as Notifications from "expo-notifications";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { api } from "./api";

Notifications.setNotificationHandler({
  handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: true }),
});

export async function setupChannels() {
  if (Platform.OS !== "android") return;
  await Notifications.setNotificationChannelAsync("default", { name: "Dienstplan", importance: Notifications.AndroidImportance.DEFAULT });
  await Notifications.setNotificationChannelAsync("urgent", {
    name: "Kurzfristige Änderungen", importance: Notifications.AndroidImportance.HIGH, vibrationPattern: [0, 250, 250, 250],
  });
}

/** Asks for permission, gets the Expo push token and registers it with the server. Returns the token or null (simulator, denied, no project id). */
export async function registerForPush(): Promise<string | null> {
  if (!Device.isDevice) return null; // push needs a physical device
  await setupChannels();
  let { status } = await Notifications.getPermissionsAsync();
  if (status !== "granted") status = (await Notifications.requestPermissionsAsync()).status;
  if (status !== "granted") return null;
  const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ?? Constants.easConfig?.projectId;
  if (!projectId) { console.warn("EXPO_PUBLIC_EAS_PROJECT_ID is not set; cannot get a push token"); return null; }
  const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
  await api("/devices", { method: "POST", body: { token, platform: Platform.OS } });
  return token;
}

export async function unregisterPush(token: string | null) {
  if (!token) return;
  await api("/devices", { method: "DELETE", body: { token } }).catch(() => {});
}
