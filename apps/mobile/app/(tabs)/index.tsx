import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from "react-native";
import { Banner, Button, Card, Chip } from "@/components/ui";
import { MonthBar } from "@/components/MonthBar";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/cache";
import { daysOf, fmtTime, shiftHours, thisMonth, WEEKDAYS, wd } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { PlanResponse } from "@/lib/types";

export default function MeinPlan() {
  const t = useTheme();
  const { user } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const { data, offline, cachedAt, error, loading, refresh } = useRemote<PlanResponse>(`plan.${user?.id}.${month}`, () => api(`/plan?m=${month}`));
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(`${month}-01`);

  const view = useMemo(() => {
    if (!data) return null;
    const types = new Map(data.types.map((x) => [x.id, x]));
    const mine = new Map(data.shifts.filter((s) => s.userId === user?.id).map((s) => [s.date, types.get(s.shiftTypeId)!]));
    const work = [...mine.values()].filter((x) => x.kind === "WORK");
    const hours = work.reduce((h, x) => h + shiftHours(x.startMin, x.endMin), 0);
    const abs = [...mine.values()].filter((x) => x.kind !== "WORK");
    const entries = new Map<string, PlanResponse["entries"]>();
    data.entries.forEach((e) => entries.set(e.date, [...(entries.get(e.date) ?? []), e]));
    const holiday = new Map((data.holidays ?? []).map((h) => [h.date, h.name]));
    return { mine, work: work.length, hours, abs: abs.length, entries, holiday };
  }, [data, user?.id]);

  async function add() {
    if (!title.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    await api("/personal", { body: { date, title } });
    setTitle(""); await refresh();
  }
  async function remove(id: string) { await api(`/personal/${id}`, { method: "DELETE" }); await refresh(); }

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
      <MonthBar month={month} onChange={(m) => { setMonth(m); setDate(`${m}-01`); }} />
      {offline && <Banner text={`Offline${cachedAt ? ` – Stand ${new Date(cachedAt).toLocaleString("de-DE")}` : ""}`} />}
      {error && <Banner tone="error" text={error} />}
      {data && !data.published && <Card><Text style={{ color: t.sub }}>Für diesen Monat ist noch kein Dienstplan veröffentlicht. Du bekommst eine Mitteilung, sobald er online ist.</Text></Card>}
      {data?.pendingChange && <Banner text="Eine neuere Planversion ist in Prüfung. Angezeigt wird die zuletzt veröffentlichte Version." />}

      {view && data?.published && (
        <>
          <View style={{ flexDirection: "row", gap: 10 }}>
            <Card style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Dienste</Text><Text style={{ color: t.text, fontSize: 26, fontWeight: "700" }}>{view.work}</Text>{view.abs > 0 && <Text style={{ color: t.sub, fontSize: 12 }}>+ {view.abs} Abwesenheit</Text>}</Card>
            <Card style={{ flex: 1 }}><Text style={{ color: t.sub, fontSize: 12 }}>Stunden (brutto)</Text><Text style={{ color: t.text, fontSize: 26, fontWeight: "700" }}>{String(view.hours.toFixed(1)).replace(".0", "")} h</Text></Card>
          </View>

          {daysOf(month).map((d) => {
            const st = view.mine.get(d); const es = view.entries.get(d) ?? [];
            if (!st && es.length === 0) return null;
            return (
              <Card key={d} style={{ flexDirection: "row", gap: 12, padding: 12 }}>
                <View style={{ width: 36, alignItems: "center" }}>
                  <Text style={{ color: t.sub, fontSize: 12 }}>{WEEKDAYS[wd(d)]}</Text>
                  <Text style={{ color: t.text, fontSize: 18, fontWeight: "700" }}>{d.slice(8)}</Text>
                </View>
                <View style={{ flex: 1, gap: 6 }}>
                  {view.holiday.get(d) && <Text style={{ color: t.danger, fontSize: 12, fontWeight: "600" }}>Feiertag: {view.holiday.get(d)}</Text>}
                  {st && (
                    <View style={{ gap: 2 }}>
                      <Chip label={st.name} color={st.color} />
                      <Text style={{ color: t.sub, fontSize: 12 }}>{st.kind === "WORK" ? `${fmtTime(st.startMin)}–${fmtTime(st.endMin)}` : st.paid ? "bezahlt" : "unbezahlt"}</Text>
                    </View>
                  )}
                  {es.map((e) => (
                    <View key={e.id} style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", backgroundColor: "#8b5cf622", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 }}>
                      <Text style={{ color: t.text, flex: 1 }}>📝 {e.title}</Text>
                      <Pressable accessibilityRole="button" accessibilityLabel={`Eintrag ${e.title} löschen`} onPress={() => remove(e.id)} hitSlop={10}><Text style={{ color: t.danger }}>löschen</Text></Pressable>
                    </View>
                  ))}
                </View>
              </Card>
            );
          })}
        </>
      )}

      <Card style={{ gap: 8 }}>
        <Text style={{ color: t.text, fontWeight: "700" }}>Eigener Eintrag <Text style={{ color: t.sub, fontWeight: "400" }}>(nur für dich sichtbar)</Text></Text>
        <TextInput accessibilityLabel="Datum" value={date} onChangeText={setDate} placeholder="JJJJ-MM-TT" placeholderTextColor={t.sub} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 10, color: t.text }} />
        <TextInput accessibilityLabel="Titel" value={title} onChangeText={setTitle} placeholder="z. B. Arzttermin" placeholderTextColor={t.sub} style={{ borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 10, color: t.text }} />
        <Button title="Hinzufügen" onPress={add} disabled={!title.trim()} />
      </Card>
    </ScrollView>
  );
}
