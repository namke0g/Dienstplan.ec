import { Stack } from "expo-router";
import { useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { ApiError, api } from "@/lib/api";
import { useRemote } from "@/lib/cache";
import { fmtTime, WEEKDAYS, wd } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { SwapBoard, SwapItem, SwapOptions, SwapType } from "@/lib/types";

const LABEL: Record<string, string> = {
  OPEN: "Offen für alle", PENDING_PARTNER: "Wartet auf Zusage", PENDING_PLANNER: "Wartet auf Planung", APPLIED: "Durchgeführt",
  DECLINED: "Abgelehnt", REJECTED: "Nicht genehmigt", CANCELLED: "Zurückgezogen", EXPIRED: "Abgelaufen",
};
const day = (d: string) => `${WEEKDAYS[wd(d)]} ${d.split("-").reverse().join(".")}`;
const shift = (t: SwapType | null) => (t ? `${t.name} ${fmtTime(t.startMin)}–${fmtTime(t.endMin)}` : "");

export default function Swaps() {
  const t = useTheme();
  const { user } = useSession();
  const { data, offline, loading, refresh } = useRemote<SwapBoard>(`swaps.${user?.id}`, () => api("/swaps"));
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [creating, setCreating] = useState<string | null>(null); // date of my shift being offered

  async function act(fn: () => Promise<unknown>, ok?: string) {
    setMessage(null);
    try { await fn(); if (ok) setMessage({ text: ok, error: false }); await refresh(); }
    catch (e) { setMessage({ text: e instanceof ApiError ? e.message : "Nicht möglich. Bist du online?", error: true }); }
  }
  const post = (id: string, action: "accept" | "decline") => act(() => api(`/swaps/${id}`, { method: "POST", body: { action } }));
  const busy = new Set((data?.mine ?? []).filter((r) => ["OPEN", "PENDING_PARTNER", "PENDING_PLANNER"].includes(r.status)).map((r) => r.date));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
      <Stack.Screen options={{ headerShown: true, title: "Diensttausch", headerStyle: { backgroundColor: t.card }, headerTitleStyle: { color: t.text } }} />
      {offline && <Banner text="Offline – Tauschanfragen brauchen eine Verbindung." />}
      {message && <Banner tone={message.error ? "error" : "warn"} text={message.text} />}

      {creating && data && <Create date={creating} shift={data.shifts.find((s) => s.date === creating)!.type}
        onDone={async (ok) => { setCreating(null); if (ok) { setMessage({ text: "Anfrage gesendet.", error: false }); await refresh(); } }} />}

      {!!data?.forMe.length && <Section title="An dich gerichtet">{data.forMe.map((r) => (
        <Card key={r.id} style={{ gap: 6 }}>
          <Text style={{ color: t.text }}><Text style={{ fontWeight: "700" }}>{r.requester.name}</Text> {r.partnerDate ? `tauscht ${shift(r.shiftType)} (${day(r.date)}) gegen deinen ${shift(r.partnerShiftType)} (${day(r.partnerDate)})` : `gibt ${shift(r.shiftType)} am ${day(r.date)} an dich ab`}</Text>
          {r.note && <Text style={{ color: t.sub }}>„{r.note}“</Text>}
          <View style={{ flexDirection: "row", gap: 8 }}><View style={{ flex: 1 }}><Button title="Zustimmen" onPress={() => post(r.id, "accept")} /></View><View style={{ flex: 1 }}><Button ghost title="Ablehnen" onPress={() => post(r.id, "decline")} /></View></View>
        </Card>))}</Section>}

      <Section title="Offene Angebote im Team">
        {data?.open.length === 0 && <Card><Text style={{ color: t.sub }}>Zurzeit bietet niemand einen Dienst an.</Text></Card>}
        {data?.open.map((r) => (
          <Card key={r.id} style={{ gap: 6 }}>
            <Text style={{ color: t.text }}><Text style={{ fontWeight: "700" }}>{r.requester.name}</Text> gibt {shift(r.shiftType)} ab · {day(r.date)}</Text>
            {r.note && <Text style={{ color: t.sub }}>„{r.note}“</Text>}
            {!!r.problems?.length && <Text style={{ color: t.danger }}>Für dich nicht möglich: {r.problems.join("; ")}</Text>}
            <Button title="Übernehmen" disabled={!!r.problems?.length} onPress={() => post(r.id, "accept")} />
          </Card>))}
      </Section>

      <Section title="Meine kommenden Dienste">
        {data?.shifts.map((s) => (
          <Card key={s.date} style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 12 }}>
            <View><Text style={{ color: t.text, fontWeight: "700" }}>{day(s.date)}</Text><Text style={{ color: t.sub }}>{shift(s.type)}</Text></View>
            {busy.has(s.date) ? <Text style={{ color: t.sub, fontSize: 12 }}>Anfrage läuft</Text> : <Pressable accessibilityRole="button" accessibilityLabel={`Dienst am ${day(s.date)} tauschen`} onPress={() => setCreating(s.date)} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 7 }}><Text style={{ color: t.text }}>Tauschen</Text></Pressable>}
          </Card>))}
        {data?.shifts.length === 0 && <Card><Text style={{ color: t.sub }}>Keine veröffentlichten Dienste in den nächsten 60 Tagen.</Text></Card>}
      </Section>

      <Section title="Meine Anfragen">
        {data?.mine.length === 0 && <Card><Text style={{ color: t.sub }}>Noch keine Anfragen.</Text></Card>}
        {data?.mine.map((r: SwapItem) => (
          <Card key={r.id} style={{ gap: 4 }}>
            <Text style={{ color: t.text, fontWeight: "700" }}>{shift(r.shiftType)} · {day(r.date)}</Text>
            <Text style={{ color: t.sub }}>{r.partner ? `→ ${r.partner.name}` : "→ alle"}{r.partnerDate ? ` gegen ${shift(r.partnerShiftType)} (${day(r.partnerDate)})` : ""}</Text>
            <Text style={{ color: t.text }}>{LABEL[r.status]}</Text>
            {r.status === "REJECTED" && r.decisionComment && <Text style={{ color: t.danger }}>Grund: {r.decisionComment}</Text>}
            {["OPEN", "PENDING_PARTNER", "PENDING_PLANNER"].includes(r.status) && <Button ghost title="Zurückziehen" onPress={() => act(() => api(`/swaps/${r.id}`, { method: "DELETE" }))} />}
          </Card>))}
      </Section>
    </ScrollView>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  const t = useTheme();
  return <View style={{ gap: 8 }}><Text style={{ color: t.text, fontWeight: "700", fontSize: 16 }}>{title}</Text>{children}</View>;
}

function Create({ date, shift: mine, onDone }: { date: string; shift: SwapType; onDone: (ok: boolean) => void }) {
  const t = useTheme();
  const [withId, setWithId] = useState<string>("");
  const [partnerDate, setPartnerDate] = useState<string>("none");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { data: opts } = useRemote<SwapOptions>(`swapopts.${date}.${withId}`, () => api(`/swaps/options?date=${date}${withId ? `&with=${withId}` : ""}`));
  const chip = (label: string, on: boolean, onPress: () => void, disabled = false) => (
    <Pressable key={label} accessibilityRole="button" accessibilityState={{ selected: on, disabled }} disabled={disabled} onPress={onPress}
      style={{ borderRadius: 999, borderWidth: 1, borderColor: on ? t.brand : t.border, backgroundColor: on ? t.brand : "transparent", paddingHorizontal: 12, paddingVertical: 7, opacity: disabled ? 0.4 : 1 }}>
      <Text style={{ color: on ? "#fff" : t.text }}>{label}</Text>
    </Pressable>
  );
  async function send() {
    setError(null);
    try { await api("/swaps", { body: { date, partnerId: withId || undefined, partnerDate: withId && partnerDate !== "none" ? partnerDate : undefined, note } }); onDone(true); }
    catch (e) { setError(e instanceof ApiError ? e.message : "Senden fehlgeschlagen. Bist du online?"); }
  }
  return (
    <Card style={{ gap: 10 }}>
      <Text style={{ color: t.text, fontWeight: "700" }}>{day(date)} · {shift(mine)}</Text>
      <Text style={{ color: t.sub }}>Mit wem?</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
        {chip("Allen anbieten", withId === "", () => { setWithId(""); setPartnerDate("none"); })}
        {opts?.colleagues.map((c) => chip(c.name, withId === c.id, () => { setWithId(c.id); setPartnerDate("none"); }))}
      </View>
      {withId !== "" && opts?.theirs && (
        <>
          <Text style={{ color: t.sub }}>Was gibt dir die Kollegin/der Kollege?</Text>
          <View style={{ gap: 6 }}>
            {chip("Nichts – ich gebe nur ab", partnerDate === "none", () => setPartnerDate("none"), !!opts.handOverProblems?.length)}
            {!!opts.handOverProblems?.length && <Text style={{ color: t.danger, fontSize: 12 }}>{opts.handOverProblems.join("; ")}</Text>}
            {opts.theirs.map((o) => (
              <View key={o.date}>
                {chip(`${day(o.date)} · ${shift(o.type)}`, partnerDate === o.date, () => setPartnerDate(o.date), o.problems.length > 0)}
                {o.problems.length > 0 && <Text style={{ color: t.danger, fontSize: 12 }}>{o.problems.join("; ")}</Text>}
              </View>))}
          </View>
        </>
      )}
      <TextInput accessibilityLabel="Nachricht" value={note} onChangeText={setNote} placeholder="Nachricht (optional)" placeholderTextColor={t.sub} maxLength={300} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 10, color: t.text }} />
      {error && <Banner tone="error" text={error} />}
      <View style={{ flexDirection: "row", gap: 8 }}><View style={{ flex: 1 }}><Button title="Anfrage senden" onPress={send} /></View><View style={{ flex: 1 }}><Button ghost title="Abbrechen" onPress={() => onDone(false)} /></View></View>
    </Card>
  );
}
