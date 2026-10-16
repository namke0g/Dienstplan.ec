import { Tabs } from "expo-router";
import { Text } from "react-native";
import { useRemote } from "@/lib/cache";
import { api } from "@/lib/api";
import { useTheme } from "@/lib/theme";
import type { NotificationItem } from "@/lib/types";

const icon = (e: string) => () => <Text style={{ fontSize: 20 }}>{e}</Text>;

export default function TabsLayout() {
  const t = useTheme();
  const { data } = useRemote<{ unread: number; items: NotificationItem[] }>("notifications", () => api("/notifications"));
  return (
    <Tabs screenOptions={{ headerStyle: { backgroundColor: t.card }, headerTitleStyle: { color: t.text }, tabBarStyle: { backgroundColor: t.card, borderTopColor: t.border }, tabBarActiveTintColor: t.brand }}>
      <Tabs.Screen name="index" options={{ title: "Mein Plan", tabBarIcon: icon("📅") }} />
      <Tabs.Screen name="team" options={{ title: "Team", tabBarIcon: icon("👥") }} />
      <Tabs.Screen name="mitteilungen" options={{ title: "Mitteilungen", tabBarIcon: icon("🔔"), tabBarBadge: data?.unread ? data.unread : undefined }} />
      <Tabs.Screen name="mehr" options={{ title: "Mehr", tabBarIcon: icon("⚙️") }} />
    </Tabs>
  );
}
