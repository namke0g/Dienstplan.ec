import { Stack } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useRemote } from "@/lib/cache";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { Balance, LeaveItem, LeaveType } from "@/lib/types";

const STATUS = { PENDING: ["Offen", "#f59e0b"], APPROVED: ["Genehmigt", "#10b981"], REJECTED: ["Abgelehnt", "#e11d48"], CANCELLED: ["Zurückgezogen", "#64748b"] } as const;
const dmy = (d: string) => d.split("-").reverse().join(".");
const today = () => new Date().toISOString().slice(0, 10);

export default function Leave() {
  const t = useTheme();
  const { user } = useSession();
  const { data, offline, loading, refresh } = useRemote<{ balances: Balance[]; types: LeaveType[]; requests: LeaveItem[] }>(`leave.${user?.id}`, () => api("/leave"));
  const [typeId, setTypeId] = useState<string | null>(null);
  const [start, setStart] = useState(today());
  const [end, setEnd] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const selected = data?.types.find((x) => x.id === (typeId ?? data.types[0]?.id));
  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 10, color: t.text } as const;

  async function submit() {
    if (!selected) return;
    setBusy(true); setError(null); setSent(false);
    try {
      await api("/leave", { body: { typeId: selected.id, start, end, note } });
      setSent(true); setNote(""); await refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Antrag konnte nicht gesendet werden. Bist du online?");
    } finally { setBusy(false); }
  }
  async function withdraw(id: string) {
    try { await api(`/leave/${id}`, { method: "DELETE" }); await refresh(); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Nicht möglich. Bist du online?"); }
  }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
      <Stack.Screen options={{ headerShown: true, title: "Abwesenheit beantragen", headerStyle: { backgroundColor: t.card }, headerTitleStyle: { color: t.text } }} />
      {offline && <Banner text="Offline – Anträge können nur mit Verbindung gesendet werden." />}
      {data?.balances.map((b) => (
        <Card key={b.year} style={{ gap: 4 }}>
          {!b.configured ? <Text style={{ color: t.sub }}>Für {b.year} ist noch kein Urlaubsanspruch hinterlegt.</Text> : (
            <>
              <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline" }}>
                <Text style={{ color: t.text, fontWeight: "700" }}>Resturlaub {b.year}</Text>
                <Text style={{ color: (b.remaining ?? 0) < 0 ? t.danger : t.text, fontSize: 22, fontWeight: "700" }}>{String(b.remaining).replace(".", ",")} <Text style={{ fontSize: 13, color: t.sub, fontWeight: "400" }}>von {String(b.total).replace(".", ",")} Tagen</Text></Text>
              </View>
              <Text style={{ color: t.sub, fontSize: 12 }}>Genommen {b.taken} · Geplant {(b.planned ?? 0) + (b.approvedHeld ?? 0)}{b.requested ? ` · Beantragt ${b.requested}` : ""}{b.carryOver ? ` · Übertrag ${b.carryOver}` : ""}</Text>
              {!!b.expiring && b.carryOverExpires && <Banner text={`${b.expiring} Tag(e) Übertrag verfallen am ${b.carryOverExpires.split("-").reverse().join(".")}, wenn sie nicht genommen werden.`} />}
              {!!b.forfeited && <Text style={{ color: t.danger, fontSize: 12 }}>{b.forfeited} Tag(e) Übertrag sind verfallen.</Text>}
            </>
          )}
        </Card>
      ))}
      <Card style={{ gap: 10 }}>
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
          {data?.types.map((x) => {
            const on = x.id === selected?.id;
            return (
              <Pressable key={x.id} accessibilityRole="button" accessibilityState={{ selected: on }} onPress={() => setTypeId(x.id)}
                style={{ borderRadius: 999, borderWidth: 1, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brand : "transparent", paddingHorizontal: 12, paddingVertical: 7 }}>
                <Text style={{ color: on ? "#fff" : t.text }}>{x.name}{x.paid ? "" : " (unbezahlt)"}</Text>
              </Pressable>
            );
          })}
        </View>
        <View style={{ flexDirection: "row", gap: 8 }}>
          <View style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Von (JJJJ-MM-TT)</Text><TextInput accessibilityLabel="Von" value={start} onChangeText={setStart} style={input} autoCapitalize="none" /></View>
          <View style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Bis</Text><TextInput accessibilityLabel="Bis" value={end} onChangeText={setEnd} style={input} autoCapitalize="none" /></View>
        </View>
        <TextInput accessibilityLabel="Anmerkung" value={note} onChangeText={setNote} placeholder={selected?.noteRequired ? "Grund (Pflicht)" : "Anmerkung (optional)"} placeholderTextColor={t.sub} style={input} />
        {error && <Banner tone="error" text={error} />}
        {sent && <Banner text="Antrag gesendet. Du bekommst eine Mitteilung bei der Entscheidung." />}
        <Button title={busy ? "Senden …" : "Antrag senden"} onPress={submit} disabled={busy || !selected || offline} />
        <Text style={{ color: t.sub, fontSize: 12 }}>Krankmeldungen bitte telefonisch bei der Stationsleitung.</Text>
      </Card>

      <Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>Meine Anträge</Text>
      {data?.requests.length === 0 && <Card><Text style={{ color: t.sub }}>Noch keine Anträge.</Text></Card>}
      {data?.requests.map((r) => {
        const [label, color] = STATUS[r.status];
        return (
          <Card key={r.id} style={{ gap: 4 }}>
            <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" }}>
              <Text style={{ color: t.text, fontWeight: "700", flex: 1 }}>{r.type.name}</Text>
              <View style={{ backgroundColor: color, borderRadius: 999, paddingHorizontal: 9, paddingVertical: 2 }}><Text style={{ color: "#fff", fontSize: 12, fontWeight: "600" }}>{label}</Text></View>
            </View>
            <Text style={{ color: t.sub }}>{dmy(r.start)}{r.start !== r.end ? ` – ${dmy(r.end)}` : ""}</Text>
            {r.status === "REJECTED" && r.decisionComment && <Text style={{ color: t.danger }}>Grund: {r.decisionComment}</Text>}
            {r.status === "PENDING" && <Button ghost title="Zurückziehen" onPress={() => withdraw(r.id)} />}
          </Card>
        );
      })}
    </ScrollView>
  );
}
