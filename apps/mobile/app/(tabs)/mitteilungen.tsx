import { useFocusEffect } from "expo-router";
import { useCallback } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/cache";
import { useTheme } from "@/lib/theme";
import type { NotificationItem } from "@/lib/types";

export default function Mitteilungen() {
  const t = useTheme();
  const { data, offline, loading, refresh } = useRemote<{ unread: number; items: NotificationItem[] }>("notifications", () => api("/notifications"));
  useFocusEffect(useCallback(() => { void refresh(); }, [refresh]));
  async function readAll() { await api("/notifications/read", { method: "POST", body: {} }); await refresh(); }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 10 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
      {offline && <Banner text="Offline – zuletzt geladene Mitteilungen" />}
      {data && data.unread > 0 && <Button ghost title="Alle als gelesen markieren" onPress={readAll} />}
      {data?.items.length === 0 && <Card><Text style={{ color: t.sub }}>Noch keine Mitteilungen.</Text></Card>}
      {data?.items.map((n) => (
        <Card key={n.id} style={{ opacity: n.read ? 0.65 : 1, borderColor: n.shortNotice ? t.danger : t.border, gap: 4 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={{ color: t.text, fontWeight: "700", flex: 1 }}>{n.shortNotice ? "⚠️ " : ""}{n.title}</Text>
            <Text style={{ color: t.sub, fontSize: 12 }}>{new Date(n.createdAt).toLocaleDateString("de-DE")}</Text>
          </View>
          <Text style={{ color: t.sub }}>{n.body}</Text>
        </Card>
      ))}
    </ScrollView>
  );
}
