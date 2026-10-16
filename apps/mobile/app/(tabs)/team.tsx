import { useState } from "react";
import { RefreshControl, ScrollView, Text, View } from "react-native";
import { Banner, Card } from "@/components/ui";
import { MonthBar } from "@/components/MonthBar";
import { api } from "@/lib/api";
import { useRemote } from "@/lib/cache";
import { daysOf, thisMonth, WEEKDAYS, wd } from "@/lib/format";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";
import type { PlanResponse } from "@/lib/types";

const CELL = 34;

export default function Team() {
  const t = useTheme();
  const { user } = useSession();
  const [month, setMonth] = useState(thisMonth());
  const { data, offline, cachedAt, loading, refresh } = useRemote<PlanResponse>(`plan.${user?.id}.${month}`, () => api(`/plan?m=${month}`));
  const types = new Map((data?.types ?? []).map((x) => [x.id, x]));
  const at = new Map((data?.shifts ?? []).map((s) => [`${s.userId}|${s.date}`, types.get(s.shiftTypeId)]));
  const days = daysOf(month);
  const holiday = new Map((data?.holidays ?? []).map((h) => [h.date, h.name]));

  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} refreshControl={<RefreshControl refreshing={loading} onRefresh={refresh} />}>
      <MonthBar month={month} onChange={setMonth} />
      {offline && <Banner text={`Offline${cachedAt ? ` – Stand ${new Date(cachedAt).toLocaleString("de-DE")}` : ""}`} />}
      {data && !data.published && <Card><Text style={{ color: t.sub }}>Noch kein veröffentlichter Plan.</Text></Card>}
      {data?.published && (
        <>
          <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 10 }}>
            {data.types.map((x) => (
              <View key={x.id} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
                <View style={{ backgroundColor: x.color, borderRadius: 4, paddingHorizontal: 5, minWidth: 20, alignItems: "center" }}><Text style={{ color: "#fff", fontWeight: "700", fontSize: 11 }}>{x.code}</Text></View>
                <Text style={{ color: t.sub, fontSize: 12 }}>{x.name}</Text>
              </View>
            ))}
          </View>
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ScrollView horizontal>
              <View>
                <View style={{ flexDirection: "row" }}>
                  <View style={{ width: 110, padding: 6 }} />
                  {days.map((d) => (
                    <View key={d} accessible accessibilityLabel={holiday.get(d) ? `${d}, Feiertag: ${holiday.get(d)}` : d}
                      style={{ width: CELL, alignItems: "center", paddingVertical: 4, backgroundColor: holiday.has(d) ? t.danger + "22" : [0, 6].includes(wd(d)) ? t.weekend : undefined }}>
                      <Text style={{ color: holiday.has(d) ? t.danger : t.sub, fontSize: 10 }}>{WEEKDAYS[wd(d)]}</Text><Text style={{ color: holiday.has(d) ? t.danger : t.text, fontSize: 12, fontWeight: "600" }}>{Number(d.slice(8))}</Text>
                    </View>
                  ))}
                </View>
                {data.staff.map((p) => (
                  <View key={p.id} style={{ flexDirection: "row", backgroundColor: p.id === user?.id ? t.brand + "22" : undefined }}>
                    <Text numberOfLines={1} style={{ width: 110, padding: 6, color: t.text, fontWeight: p.id === user?.id ? "700" : "500" }}>{p.name}</Text>
                    {days.map((d) => {
                      const x = at.get(`${p.id}|${d}`);
                      return (
                        <View key={d} style={{ width: CELL, height: CELL, padding: 2 }} accessible accessibilityLabel={`${p.name}, ${d}: ${x?.name ?? "frei"}`}>
                          {x && <View style={{ flex: 1, borderRadius: 6, backgroundColor: x.color, alignItems: "center", justifyContent: "center" }}><Text style={{ color: "#fff", fontSize: 11, fontWeight: "700" }}>{x.code}</Text></View>}
                        </View>
                      );
                    })}
                  </View>
                ))}
              </View>
            </ScrollView>
          </Card>
        </>
      )}
    </ScrollView>
  );
}
