import { Pressable, StyleSheet, Text, View, type ViewStyle } from "react-native";
import { useTheme } from "@/lib/theme";

export function Card({ children, style }: { children: React.ReactNode; style?: ViewStyle }) {
  const t = useTheme();
  return <View style={[s.card, { backgroundColor: t.card, borderColor: t.border }, style]}>{children}</View>;
}
export function Button({ title, onPress, ghost, disabled }: { title: string; onPress: () => void; ghost?: boolean; disabled?: boolean }) {
  const t = useTheme();
  return (
    <Pressable accessibilityRole="button" disabled={disabled} onPress={onPress}
      style={({ pressed }) => [s.btn, ghost ? { borderWidth: 1, borderColor: t.border } : { backgroundColor: t.brand }, (pressed || disabled) && { opacity: 0.6 }]}>
      <Text style={{ color: ghost ? t.text : "#fff", fontWeight: "600" }}>{title}</Text>
    </Pressable>
  );
}
export function Banner({ text, tone = "warn" }: { text: string; tone?: "warn" | "error" }) {
  const t = useTheme();
  return <View style={[s.banner, { backgroundColor: tone === "warn" ? t.warn : t.danger + "22" }]}><Text style={{ color: tone === "warn" ? t.warnText : t.danger }}>{text}</Text></View>;
}
export function Chip({ label, color }: { label: string; color: string }) {
  return <View style={[s.chip, { backgroundColor: color }]}><Text style={{ color: "#fff", fontWeight: "600", fontSize: 13 }}>{label}</Text></View>;
}
const s = StyleSheet.create({
  card: { borderWidth: 1, borderRadius: 16, padding: 14 },
  btn: { borderRadius: 12, paddingVertical: 11, paddingHorizontal: 16, alignItems: "center" },
  banner: { borderRadius: 12, padding: 10 },
  chip: { alignSelf: "flex-start", borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
});
