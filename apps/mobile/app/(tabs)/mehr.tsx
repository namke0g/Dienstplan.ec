import * as Clipboard from "expo-clipboard";
import { useState } from "react";
import { router } from "expo-router";
import { Alert, Linking, ScrollView, Switch, Text, View } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { api } from "@/lib/api";
import { registerForPush } from "@/lib/push";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export default function Mehr() {
  const t = useTheme();
  const { user, setUser, logout } = useSession();
  const [msg, setMsg] = useState<string | null>(null);

  async function togglePush(on: boolean) {
    try {
      await api("/settings", { method: "PATCH", body: { pushEnabled: on } });
      if (user) setUser({ ...user, pushEnabled: on });
      if (on && !(await registerForPush())) setMsg("Push konnte auf diesem Gerät nicht aktiviert werden (Berechtigung verweigert oder Simulator).");
      else setMsg(null);
    } catch { setMsg("Einstellung konnte nicht gespeichert werden. Bist du online?"); }
  }
  async function calendar(kind: "apple" | "google" | "copy") {
    try {
      const c = await api<{ https: string; webcal: string }>("/calendar");
      if (kind === "apple") await Linking.openURL(c.webcal);
      else if (kind === "google") await Linking.openURL(`https://calendar.google.com/calendar/r?cid=${encodeURIComponent(c.webcal)}`);
      else { await Clipboard.setStringAsync(c.https); Alert.alert("Link kopiert", "Füge ihn im Browser unter Google Kalender → Weitere Kalender → Per URL ein."); }
    } catch { setMsg("Kalender-Link konnte nicht geladen werden."); }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
      <Card><Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{user?.name}</Text></Card>
      {msg && <Banner text={msg} />}
      <Button title="Urlaub & Abwesenheit beantragen" onPress={() => router.push("/leave")} />
      {user?.role === "EMPLOYEE" && <Button ghost title="Diensttausch" onPress={() => router.push("/swaps")} />}
      <Card style={{ flexDirection: "row", alignItems: "center", gap: 12 }}>
        <View style={{ flex: 1 }}><Text style={{ color: t.text, fontWeight: "700" }}>Push-Mitteilungen</Text><Text style={{ color: t.sub, fontSize: 12 }}>Plan veröffentlicht, Dienständerungen, Prüfungen</Text></View>
        <Switch accessibilityLabel="Push-Mitteilungen" value={!!user?.pushEnabled} onValueChange={togglePush} />
      </Card>
      <Card style={{ gap: 8 }}>
        <Text style={{ color: t.text, fontWeight: "700" }}>Kalender-Abo</Text>
        <Text style={{ color: t.sub, fontSize: 12 }}>Deine Dienste automatisch im Kalender. Persönliche Einträge werden nicht übertragen.</Text>
        <Button title="In Apple Kalender abonnieren" onPress={() => calendar("apple")} />
        <Button ghost title="In Google Kalender öffnen" onPress={() => calendar("google")} />
        <Button ghost title="Link kopieren" onPress={() => calendar("copy")} />
      </Card>
      <Button ghost title="Abmelden" onPress={logout} />
    </ScrollView>
  );
}
