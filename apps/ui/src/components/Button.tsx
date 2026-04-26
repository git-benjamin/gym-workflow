/** Bold Typography buttons: primary (text + animated underline), outline, ghost. */
import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  View,
  type PressableProps,
  type StyleProp,
  type ViewStyle,
} from "react-native";

import { borderWidth, colors, fonts, fontSize, layout, space, tracking } from "../theme";
import { Text } from "./Text";

type Variant = "primary" | "outline" | "ghost";
type Size = "sm" | "md" | "lg";

interface Props extends Omit<PressableProps, "style" | "children"> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  fullWidth?: boolean;
  leadingIcon?: ReactNode;
  trailingIcon?: ReactNode;
  children: ReactNode;
  style?: StyleProp<ViewStyle>;
}

const sizes: Record<Size, { paddingVertical: number; paddingHorizontal: number; fontSize: number }> = {
  sm: { paddingVertical: space[2], paddingHorizontal: space[4], fontSize: fontSize.xs },
  md: { paddingVertical: space[3], paddingHorizontal: space[5], fontSize: fontSize.sm },
  lg: { paddingVertical: space[4], paddingHorizontal: space[6], fontSize: fontSize.base },
};

export function Button({
  variant = "primary",
  size = "md",
  loading,
  disabled,
  fullWidth,
  leadingIcon,
  trailingIcon,
  children,
  onPress,
  style,
  ...rest
}: Props) {
  const dims = sizes[size];
  const isDisabled = !!(disabled || loading);

  return (
    <Pressable
      disabled={isDisabled}
      onPress={onPress}
      style={({ pressed }) => [
        s.base,
        {
          paddingVertical: dims.paddingVertical,
          paddingHorizontal: variant === "primary" ? 0 : dims.paddingHorizontal,
          minHeight: layout.touchTarget,
          alignSelf: fullWidth ? "stretch" : "flex-start",
          opacity: isDisabled ? 0.5 : 1,
          transform: [{ translateY: pressed && !isDisabled ? 1 : 0 }],
        },
        variant === "outline" && {
          borderWidth: borderWidth.hairline,
          borderColor: colors.foreground,
        },
        style,
      ]}
      accessibilityRole="button"
      {...rest}
    >
      {({ pressed }) => {
        // Native RN doesn't expose hovered; pressed covers our active-press feedback.
        const isHover = pressed;
        const textColor =
          variant === "primary"
            ? colors.accent
            : variant === "outline"
              ? isHover
                ? colors.background
                : colors.foreground
              : isHover
                ? colors.foreground
                : colors.mutedForeground;

        return (
          <View
            style={[
              s.contentRow,
              variant === "outline" && isHover && { backgroundColor: colors.foreground },
            ]}
          >
            {loading ? (
              <ActivityIndicator size="small" color={textColor} />
            ) : (
              <>
                {leadingIcon ? <View style={s.icon}>{leadingIcon}</View> : null}
                <Text
                  style={{
                    fontFamily: fonts.sansSemibold,
                    fontSize: dims.fontSize,
                    letterSpacing: tracking.wider * dims.fontSize,
                    color: textColor,
                    textTransform: "uppercase",
                  }}
                >
                  {children}
                </Text>
                {trailingIcon ? <View style={s.icon}>{trailingIcon}</View> : null}
              </>
            )}
            {variant === "primary" ? (
              <View
                style={[
                  s.underline,
                  { backgroundColor: colors.accent },
                  isHover && { transform: [{ scaleX: 1.1 }] },
                ]}
              />
            ) : null}
          </View>
        );
      }}
    </Pressable>
  );
}

const s = StyleSheet.create({
  base: {
    justifyContent: "center",
    alignItems: "flex-start",
  },
  contentRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: space[2],
    position: "relative",
    paddingHorizontal: 0,
    paddingVertical: 0,
  },
  underline: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -4,
    height: 2,
  },
  icon: {
    alignItems: "center",
    justifyContent: "center",
  },
});
