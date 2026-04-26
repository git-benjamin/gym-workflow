/** Typed Text variants — every text in the app should go through one of these. */
import { type ReactNode } from "react";
import { Text as RNText, type TextProps as RNTextProps, type TextStyle } from "react-native";

import { colors, fonts, fontSize, leading, tracking } from "../theme";

type Variant =
  | "display" // 3xl-6xl, sansExtrabold, tightest tracking
  | "h1" // 4xl, sansBold, tight tracking
  | "h2" // 3xl, sansBold, tight tracking
  | "h3" // 2xl, sansSemibold
  | "lead" // lg, sans, normal tracking
  | "body" // base, sans
  | "small" // sm, sans
  | "label" // xs, mono uppercase wider
  | "labelLarge" // sm, mono uppercase wider
  | "mono"; // base, mono

interface Props extends RNTextProps {
  variant?: Variant;
  color?: keyof typeof colors;
  uppercase?: boolean;
  align?: TextStyle["textAlign"];
  children?: ReactNode;
}

const styles: Record<Variant, TextStyle> = {
  display: {
    fontFamily: fonts.sansExtrabold,
    fontSize: fontSize["5xl"],
    letterSpacing: tracking.tighter * fontSize["5xl"],
    lineHeight: fontSize["5xl"] * leading.tight,
  },
  h1: {
    fontFamily: fonts.sansBold,
    fontSize: fontSize["4xl"],
    letterSpacing: tracking.tight * fontSize["4xl"],
    lineHeight: fontSize["4xl"] * leading.tight,
  },
  h2: {
    fontFamily: fonts.sansBold,
    fontSize: fontSize["3xl"],
    letterSpacing: tracking.tight * fontSize["3xl"],
    lineHeight: fontSize["3xl"] * leading.tight,
  },
  h3: {
    fontFamily: fonts.sansSemibold,
    fontSize: fontSize["2xl"],
    letterSpacing: tracking.tight * fontSize["2xl"],
    lineHeight: fontSize["2xl"] * leading.snug,
  },
  lead: {
    fontFamily: fonts.sans,
    fontSize: fontSize.lg,
    letterSpacing: tracking.normal * fontSize.lg,
    lineHeight: fontSize.lg * leading.normal,
  },
  body: {
    fontFamily: fonts.sans,
    fontSize: fontSize.base,
    letterSpacing: tracking.normal * fontSize.base,
    lineHeight: fontSize.base * leading.normal,
  },
  small: {
    fontFamily: fonts.sans,
    fontSize: fontSize.sm,
    letterSpacing: tracking.normal * fontSize.sm,
    lineHeight: fontSize.sm * leading.normal,
  },
  label: {
    fontFamily: fonts.mono,
    fontSize: fontSize.xs,
    letterSpacing: tracking.widest * fontSize.xs,
    lineHeight: fontSize.xs * leading.snug,
    textTransform: "uppercase",
  },
  labelLarge: {
    fontFamily: fonts.mono,
    fontSize: fontSize.sm,
    letterSpacing: tracking.wider * fontSize.sm,
    lineHeight: fontSize.sm * leading.snug,
    textTransform: "uppercase",
  },
  mono: {
    fontFamily: fonts.mono,
    fontSize: fontSize.base,
    letterSpacing: tracking.normal * fontSize.base,
    lineHeight: fontSize.base * leading.normal,
  },
};

export function Text({
  variant = "body",
  color = "foreground",
  uppercase,
  align,
  style,
  children,
  ...rest
}: Props) {
  return (
    <RNText
      style={[
        styles[variant],
        { color: colors[color] },
        uppercase ? { textTransform: "uppercase" } : null,
        align ? { textAlign: align } : null,
        style,
      ]}
      {...rest}
    >
      {children}
    </RNText>
  );
}
