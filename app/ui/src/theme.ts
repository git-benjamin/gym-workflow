/** Bold Typography design tokens — see .claude/skills/ui-designer.md for the spec. */
import { Platform } from "react-native";

// ── Colors (dark mode) ──────────────────────────────────────────────────
export const colors = {
  background: "#0A0A0A",
  foreground: "#FAFAFA",
  muted: "#1A1A1A",
  mutedForeground: "#737373",
  accent: "#FF3D00",
  accentForeground: "#0A0A0A",
  border: "#262626",
  borderHover: "#3a3a3a",
  input: "#1A1A1A",
  card: "#0F0F0F",
  cardForeground: "#FAFAFA",
  ring: "#FF3D00",

  // Bubble-specific (chat)
  userBubble: "#FF3D00",
  userBubbleText: "#0A0A0A",
  modelBubble: "#0F0F0F",
  modelBubbleText: "#FAFAFA",
} as const;

// ── Spacing (4px base) ───────────────────────────────────────────────────
export const space = {
  px: 1,
  0.5: 2,
  1: 4,
  1.5: 6,
  2: 8,
  2.5: 10,
  3: 12,
  4: 16,
  5: 20,
  6: 24,
  7: 28,
  8: 32,
  10: 40,
  12: 48,
  14: 56,
  16: 64,
  20: 80,
  24: 96,
  28: 112,
} as const;

// ── Type scale ───────────────────────────────────────────────────────────
export const fontSize = {
  xs: 12,
  sm: 14,
  base: 16,
  lg: 18,
  xl: 20,
  "2xl": 24,
  "3xl": 32,
  "4xl": 40,
  "5xl": 56,
  "6xl": 72,
} as const;

// ── Tracking (letter-spacing, in absolute em values for RN) ─────────────
export const tracking = {
  tighter: -0.06,
  tight: -0.04,
  normal: -0.01,
  wide: 0.05,
  wider: 0.1,
  widest: 0.2,
} as const;

// ── Line heights ─────────────────────────────────────────────────────────
export const leading = {
  none: 1,
  tight: 1.1,
  snug: 1.25,
  normal: 1.6,
  relaxed: 1.75,
} as const;

// ── Font families ───────────────────────────────────────────────────────
/** Resolved at runtime — these are the *names* registered in App.tsx via expo-font. */
export const fonts = {
  sans: "InterTight_400Regular",
  sansMedium: "InterTight_500Medium",
  sansSemibold: "InterTight_600SemiBold",
  sansBold: "InterTight_700Bold",
  sansExtrabold: "InterTight_800ExtraBold",
  mono: Platform.select({
    ios: "JetBrainsMono_400Regular",
    android: "JetBrainsMono_400Regular",
    default: "JetBrainsMono_400Regular",
  })!,
  monoBold: "JetBrainsMono_700Bold",
} as const;

// ── Border ───────────────────────────────────────────────────────────────
export const borderWidth = {
  hairline: 1,
  thick: 2,
} as const;

/** No border-radius anywhere. Sharp edges match sharp typography. */
export const radius = 0;

// ── Animation durations ─────────────────────────────────────────────────
export const duration = {
  micro: 150,
  standard: 200,
  long: 500,
} as const;

// ── Layout ──────────────────────────────────────────────────────────────
export const layout = {
  containerMaxWidth: 1200,
  containerPaddingMobile: space[6],
  containerPaddingTablet: space[12],
  containerPaddingDesktop: space[16],
  bubbleMaxWidth: "85%" as const,
  touchTarget: 44,
} as const;
