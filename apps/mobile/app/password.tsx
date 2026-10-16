import { Stack, router } from "expo-router";
import { useState } from "react";
import { ScrollView, Text, TextInput } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { ApiError, api, setToken } from "@/lib/api";
import { useTheme } from "@/lib/theme";

export default function Password() {
  const t = useTheme();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [repeat, setRepeat] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 12, color: t.text, fontSize: 16 } as const;

  async function submit() {
    setError(null);
    if (next !== repeat) return setError("Die beiden neuen Passwörter stimmen nicht überein.");
    setBusy(true);
    try {
      const r = await api<{ token: string }>("/password", { body: { current, next } });
      await setToken(r.token); // other devices were signed out; this one gets a fresh token
      router.back();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Nicht möglich. Bist du online?");
    } finally { setBusy(false); }
  }
  return (
    <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
      <Stack.Screen options={{ headerShown: true, title: "Passwort ändern", headerStyle: { backgroundColor: t.card }, headerTitleStyle: { color: t.text } }} />
      <Card style={{ gap: 10 }}>
        <TextInput accessibilityLabel="Aktuelles Passwort" placeholder="Aktuelles Passwort" placeholderTextColor={t.sub} secureTextEntry autoComplete="current-password" value={current} onChangeText={setCurrent} style={input} />
        <TextInput accessibilityLabel="Neues Passwort" placeholder="Neues Passwort (mind. 12 Zeichen)" placeholderTextColor={t.sub} secureTextEntry autoComplete="new-password" value={next} onChangeText={setNext} style={input} />
        <TextInput accessibilityLabel="Neues Passwort wiederholen" placeholder="Neues Passwort wiederholen" placeholderTextColor={t.sub} secureTextEntry autoComplete="new-password" value={repeat} onChangeText={setRepeat} style={input} />
        {error && <Banner tone="error" text={error} />}
        <Button title={busy ? "Speichern …" : "Passwort ändern"} onPress={submit} disabled={busy || !current || next.length < 12} />
        <Text style={{ color: t.sub, fontSize: 12 }}>Auf allen anderen Geräten musst du dich danach neu anmelden.</Text>
      </Card>
    </ScrollView>
  );
}
