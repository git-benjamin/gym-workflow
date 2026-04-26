import { type ReactNode } from "react";
import { View, type StyleProp, type ViewStyle } from "react-native";

import { borderWidth, colors, space } from "../theme";

interface Props {
  children: ReactNode;
  bordered?: boolean;
  highlighted?: boolean;
  padding?: number;
  style?: StyleProp<ViewStyle>;
}

/** Sharp-edged container — no radius, optional 1px border, accent border when highlighted. */
export function Surface({ children, bordered = true, highlighted, padding = space[6], style }: Props) {
  return (
    <View
      style={[
        {
          padding,
          borderWidth: bordered ? (highlighted ? borderWidth.thick : borderWidth.hairline) : 0,
          borderColor: highlighted ? colors.accent : colors.border,
        },
        style,
      ]}
    >
      {children}
    </View>
  );
}
