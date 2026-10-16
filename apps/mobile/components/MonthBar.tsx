import { Pressable, Text, View } from "react-native";
import { monthLabel, shiftMonth } from "@/lib/format";
import { useTheme } from "@/lib/theme";

export function MonthBar({ month, onChange }: { month: string; onChange: (m: string) => void }) {
  const t = useTheme();
  const btn = (label: string, d: number, a11y: string) => (
    <Pressable accessibilityRole="button" accessibilityLabel={a11y} onPress={() => onChange(shiftMonth(month, d))}
      style={{ width: 44, height: 44, borderRadius: 12, borderWidth: 1, borderColor: t.border, alignItems: "center", justifyContent: "center" }}>
      <Text style={{ color: t.text, fontSize: 22 }}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between" }}>
      {btn("‹", -1, "Vorheriger Monat")}
      <Text style={{ color: t.text, fontSize: 18, fontWeight: "700", textTransform: "capitalize" }}>{monthLabel(month)}</Text>
      {btn("›", 1, "Nächster Monat")}
    </View>
  );
}
