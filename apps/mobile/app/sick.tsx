import { Stack } from "expo-router";
import { useState } from "react";
import { RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useRemote } from "@/lib/cache";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { SickReportItem } from "@/lib/types";

/** The phone's local date (not UTC: at 0:30 in Germany UTC is still yesterday). */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const dmy = (d: string) => d.split("-").reverse().join(".");

export default function Sick() {
  const t = useTheme();
  const { user } = useSession();
  const { data, offline, loading, refresh } = useRemote<{ reports: SickReportItem[] }>(`sick.${user?.id}`, () => api("/sick"));
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [ends, setEnds] = useState<Record<string, string>>({});
  const [backs, setBacks] = useState<Record<string, string>>({});
  const backDefault = (r: SickReportItem) => (today() > r.start ? today() : r.start);
  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 10, color: t.text } as const;

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ text: ok, error: false }); await refresh(); }
    catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Nicht gesendet. Bist du online? Melde dich sonst telefonisch.", error: true }); }
    finally { setBusy(false); }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ headerShown: true, title: "Krank melden", headerStyle: { backgroundColor: t.card }, headerTitleStyle: { color: t.text } }} />
      {offline && <Banner text="Offline – bitte melde dich telefonisch bei der Stationsleitung." />}
      {msg && <Banner tone={msg.error ? "error" : "warn"} text={msg.text} />}
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Erster Tag (JJJJ-MM-TT)</Text><TextInput accessibilityLabel="Erster Krankheitstag" value={start} onChangeText={setStart} style={input} autoCapitalize="none" /></View>
          <View style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Voraussichtlich bis</Text><TextInput accessibilityLabel="Voraussichtlich bis" value={end} onChangeText={setEnd} style={input} autoCapitalize="none" /></View>
        </View>
        <TextInput accessibilityLabel="Hinweis" value={note} onChangeText={setNote} placeholder="Hinweis, z. B. eAU folgt (optional)" placeholderTextColor={t.sub} maxLength={200} style={input} />
        <Button title={busy ? "Senden …" : "Krank melden"} disabled={busy || offline} onPress={() => run(() => api("/sick", { body: { start, end, note } }), "Gesendet. Gute Besserung!")} />
        <Text style={{ color: t.sub, fontSize: 12 }}>Bitte keine Diagnose angeben. Die Tage stehen sofort als krank im Plan, die Planung wird benachrichtigt.</Text>
      </Card>

      <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>Meine Krankmeldungen</Text>
      {data?.reports.length === 0 && <Card><Text style={{ color: t.sub }}>Keine.</Text></Card>}
      {data?.reports.map((r) => (
        <Card key={r.id} style={{ gap: 8 }}>
          <Text style={{ color: t.text, fontWeight: "700" }}>{dmy(r.start)}{r.start !== r.end ? ` – ${dmy(r.end)}` : ""}{r.active ? "" : " · beendet"}</Text>
          {!r.selfReported && <Text style={{ color: t.sub, fontSize: 12 }}>Erfasst von {r.reportedBy}</Text>}
          {r.active && (
            <>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Neues Ende</Text><TextInput accessibilityLabel="Verlängern bis Datum" value={ends[r.id] ?? r.end} onChangeText={(v) => setEnds({ ...ends, [r.id]: v })} style={input} autoCapitalize="none" /></View>
                <View style={{ flex: 1 }}><Button ghost title="Verlängern" disabled={busy} onPress={() => run(() => api(`/sick/${r.id}`, { body: { action: "extend", end: ends[r.id] ?? r.end } }), "Verlängert.")} /></View>
              </View>
              <View style={{ flexDirection: "row", gap: 8, alignItems: "flex-end" }}>
                <View style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Wieder gesund ab</Text><TextInput accessibilityLabel="Gesund ab Datum" value={backs[r.id] ?? backDefault(r)} onChangeText={(v) => setBacks({ ...backs, [r.id]: v })} style={input} autoCapitalize="none" /></View>
                <View style={{ flex: 1 }}><Button ghost title="Gesund ab" disabled={busy} onPress={() => run(() => api(`/sick/${r.id}`, { body: { action: "end", backOn: backs[r.id] ?? backDefault(r) } }), "Gespeichert. Willkommen zurück!")} /></View>
              </View>
            </>
          )}
        </Card>
      ))}
    </ScrollView>
  );
}
