import * as Notifications from "expo-notifications";
import { Stack, router } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { ActivityIndicator, View } from "react-native";
import { SessionProvider, useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

function Gate() {
  const { user, ready } = useSession();
  const t = useTheme();
  useEffect(() => {
    if (!ready) return;
    router.replace(user ? "/(tabs)" : "/login");
  }, [user, ready]);
  useEffect(() => {
    // tapping a push opens the notification list
    const sub = Notifications.addNotificationResponseReceivedListener(() => router.push("/(tabs)/mitteilungen"));
    return () => sub.remove();
  }, []);
  if (!ready) return <View style={{ flex: 1, justifyContent: "center", backgroundColor: t.bg }}><ActivityIndicator /></View>;
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: t.bg } }} />;
}

export default function Root() {
  return (
    <SessionProvider>
      <StatusBar style="auto" />
      <Gate />
    </SessionProvider>
  );
}
