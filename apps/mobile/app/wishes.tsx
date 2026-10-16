import { Stack } from "expo-router";
import { useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useRemote } from "@/lib/cache";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { WishesData } from "@/lib/types";

const WD = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];
const label = (d: string) => `${WD[new Date(`${d}T00:00:00Z`).getUTCDay()]} ${d.slice(8)}.${d.slice(5, 7)}.`;
const MONTHS = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const shift = (m: string, n: number) => new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)) - 1 + n, 1)).toISOString().slice(0, 7);
type Pref = "prefer" | "avoid" | "any";

export default function Wishes() {
  const t = useTheme();
  const { user } = useSession();
  const [month, setMonth] = useState<string | null>(null); // null: the server's default (next month)
  const { data, offline, loading, refresh } = useRemote<WishesData>(`wishes.${user?.id}.${month ?? "next"}`, () => api(`/wishes${month ? `?m=${month}` : ""}`));
  const [date, setDate] = useState("");
  const [wish, setWish] = useState<string>("FREE"); // "FREE" or a shift type id
  const [note, setNote] = useState("");
  const [prefs, setPrefs] = useState<Record<string, Pref>>({});
  const [prefNote, setPrefNote] = useState("");
  const [prefsDirty, setPrefsDirty] = useState(false); // unsaved preference edits survive refreshes
  const [msg, setMsg] = useState<{ text: string; error: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 10, color: t.text } as const;
  const m = data?.month;

  useEffect(() => {
    if (!data) return;
    setDate((d) => (d.startsWith(data.month) ? d : `${data.month}-01`));
    if (prefsDirty) return;
    setPrefs(Object.fromEntries(data.shifts.map((s) => [s.id, data.preference.prefer.includes(s.id) ? "prefer" : data.preference.avoid.includes(s.id) ? "avoid" : "any"])));
    setPrefNote(data.preference.note ?? "");
  }, [data, prefsDirty]);

  async function run(fn: () => Promise<unknown>, ok: string) {
    setBusy(true); setMsg(null);
    try { await fn(); setMsg({ text: ok, error: false }); await refresh(); }
    catch (e) { setMsg({ text: e instanceof ApiError ? e.message : "Nicht gespeichert. Bist du online?", error: true }); }
    finally { setBusy(false); }
  }
  const chip = (active: boolean) => ({ borderWidth: 1, borderColor: active ? t.brand : t.border, backgroundColor: active ? t.brand : "transparent", borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 });
  const chipText = (active: boolean) => ({ color: active ? "#fff" : t.text, fontSize: 13 });

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ headerShown: true, title: "Wünsche", headerStyle: { backgroundColor: t.card }, headerTitleStyle: { color: t.text } }} />
      {offline && <Banner text="Offline – Wünsche können nur mit Verbindung gespeichert werden." />}
      {msg && <Banner tone={msg.error ? "error" : "warn"} text={msg.text} />}
      {m && (
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
          <Pressable accessibilityLabel="Vorheriger Monat" onPress={() => setMonth(shift(m, -1))} style={{ padding: 8 }}><Text style={{ color: t.text, fontSize: 20 }}>‹</Text></Pressable>
          <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{MONTHS[Number(m.slice(5, 7)) - 1]} {m.slice(0, 4)}</Text>
          <Pressable accessibilityLabel="Nächster Monat" onPress={() => setMonth(shift(m, 1))} style={{ padding: 8 }}><Text style={{ color: t.text, fontSize: 20 }}>›</Text></Pressable>
        </View>
      )}
      {data && (data.closed ? <Card><Text style={{ color: t.sub }}>{data.closed}</Text></Card> : (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: t.sub, fontSize: 12 }}>Wunschfrei: noch {data.freeLeft} von {data.freeLimit}</Text>
          <Text style={{ color: t.sub, fontSize: 12 }}>Tag (JJJJ-MM-TT)</Text>
          <TextInput accessibilityLabel="Tag" value={date} onChangeText={setDate} style={input} autoCapitalize="none" />
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
            {[{ id: "FREE", name: "Wunschfrei" }, ...data.shifts].map((s) => (
              <Pressable key={s.id} accessibilityRole="button" accessibilityState={{ selected: wish === s.id }} onPress={() => setWish(s.id)} style={chip(wish === s.id)}><Text style={chipText(wish === s.id)}>{s.name}</Text></Pressable>
            ))}
          </View>
          <TextInput accessibilityLabel="Anmerkung" value={note} onChangeText={setNote} placeholder="Anmerkung (optional, nur für die Planung)" placeholderTextColor={t.sub} maxLength={200} style={input} />
          <Button title={busy ? "Speichern …" : "Wunsch speichern"} disabled={busy || offline} onPress={() => run(() => api("/wishes", { body: { date, kind: wish === "FREE" ? "FREE" : "SHIFT", shiftTypeId: wish === "FREE" ? null : wish, note } }).then(() => setNote("")), "Wunsch gespeichert.")} />
        </Card>
      ))}

      {data?.wishes.length === 0 && <Card><Text style={{ color: t.sub }}>Keine Wünsche für diesen Monat.</Text></Card>}
      {data?.wishes.map((w) => (
        <Card key={w.id} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <Text style={{ color: t.text, flex: 1 }}><Text style={{ fontWeight: "700" }}>{label(w.date)}</Text> · {w.kind === "FREE" ? "Wunschfrei" : w.shiftType?.name}{w.note ? ` – „${w.note}“` : ""}</Text>
          {!data.closed && <Button ghost title="Löschen" disabled={busy} onPress={() => run(() => api(`/wishes/${w.id}`, { method: "DELETE" }), "Wunsch gelöscht.")} />}
        </Card>
      ))}

      {data && (
        <Card style={{ gap: 10 }}>
          <Text style={{ color: t.text, fontWeight: "700" }}>Dauerhafte Vorlieben</Text>
          {data.shifts.map((s) => (
            <View key={s.id} style={{ gap: 4 }}>
              <Text style={{ color: t.text }}>{s.name}</Text>
              <View style={{ flexDirection: "row", gap: 6 }}>
                {(["prefer", "avoid", "any"] as const).map((v) => (
                  <Pressable key={v} accessibilityRole="button" accessibilityLabel={`${s.name}: ${v === "prefer" ? "gern" : v === "avoid" ? "möglichst nicht" : "egal"}`} accessibilityState={{ selected: prefs[s.id] === v }}
                    onPress={() => { setPrefsDirty(true); setPrefs((p) => ({ ...p, [s.id]: v })); }} style={chip(prefs[s.id] === v)}>
                    <Text style={chipText(prefs[s.id] === v)}>{v === "prefer" ? "gern" : v === "avoid" ? "möglichst nicht" : "egal"}</Text>
                  </Pressable>
                ))}
              </View>
            </View>
          ))}
          <TextInput accessibilityLabel="Hinweis für die Planung" value={prefNote} onChangeText={(v) => { setPrefsDirty(true); setPrefNote(v); }} placeholder="Hinweis, z. B. Kinderbetreuung bis 15 Uhr" placeholderTextColor={t.sub} maxLength={300} style={input} />
          <Button ghost title="Vorlieben speichern" disabled={busy || offline} onPress={() => run(() => api("/wishes/preferences", {
            body: { prefer: Object.keys(prefs).filter((k) => prefs[k] === "prefer"), avoid: Object.keys(prefs).filter((k) => prefs[k] === "avoid"), note: prefNote },
          }).then(() => setPrefsDirty(false)), "Vorlieben gespeichert.")} />
        </Card>
      )}
      <Text style={{ color: t.sub, fontSize: 12 }}>Wünsche sind Hinweise für die Planung, kein Anspruch. Kolleg:innen, PDL und Betriebsrat sehen sie nicht.</Text>
    </ScrollView>
  );
}
