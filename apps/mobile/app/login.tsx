import { useState } from "react";
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from "react-native";
import { Banner, Button, Card } from "@/components/ui";
import { ApiError, NetworkError } from "@/lib/api";
import { useSession } from "@/lib/session";
import { useTheme } from "@/lib/theme";

export default function Login() {
  const t = useTheme();
  const { login } = useSession();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true); setError(null);
    try { await login(email.trim(), password); }
    catch (e) {
      setError(e instanceof NetworkError ? "Keine Verbindung zum Server." : e instanceof ApiError && e.status === 401 ? "E-Mail oder Passwort ist falsch." : "Anmeldung fehlgeschlagen.");
    } finally { setBusy(false); }
  }
  const input = { borderWidth: 1, borderColor: t.border, borderRadius: 12, padding: 12, color: t.text, backgroundColor: t.bg, fontSize: 16 } as const;
  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={{ flex: 1, justifyContent: "center", padding: 20 }}>
      <Card style={{ gap: 12 }}>
        <Text style={{ color: t.text, fontSize: 24, fontWeight: "700" }}>Dienstplan</Text>
        <Text style={{ color: t.sub }}>Bitte melde dich an.</Text>
        <View style={{ gap: 10 }}>
          <TextInput accessibilityLabel="E-Mail" placeholder="E-Mail" placeholderTextColor={t.sub} autoCapitalize="none" autoComplete="email" keyboardType="email-address" textContentType="username" value={email} onChangeText={setEmail} style={input} />
          <TextInput accessibilityLabel="Passwort" placeholder="Passwort" placeholderTextColor={t.sub} secureTextEntry autoComplete="current-password" textContentType="password" value={password} onChangeText={setPassword} onSubmitEditing={submit} style={input} />
        </View>
        {error && <Banner tone="error" text={error} />}
        <Button title={busy ? "Anmelden …" : "Anmelden"} onPress={submit} disabled={busy || !email || !password} />
      </Card>
    </KeyboardAvoidingView>
  );
}
