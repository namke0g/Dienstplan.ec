import { useColorScheme } from "react-native";

const light = { bg: "#f8fafc", card: "#ffffff", text: "#0f172a", sub: "#64748b", border: "#e2e8f0", brand: "#2563eb", danger: "#e11d48", warn: "#fef3c7", warnText: "#92400e", weekend: "#f1f5f9", chipEdge: "transparent" };
const dark = { bg: "#020617", card: "#0f172a", text: "#f1f5f9", sub: "#94a3b8", border: "#1e293b", brand: "#3b82f6", danger: "#fb7185", warn: "#451a03", warnText: "#fde68a", weekend: "#111c33", chipEdge: "rgba(255,255,255,0.25)" }; // dark shift colours (night) stay visible
export const useTheme = () => (useColorScheme() === "dark" ? dark : light);
export type Theme = typeof light;
