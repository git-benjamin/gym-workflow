import { View, type StyleProp, type ViewStyle } from "react-native";

import { borderWidth, colors } from "../theme";

interface Props {
  vertical?: boolean;
  accent?: boolean;
  thick?: boolean;
  style?: StyleProp<ViewStyle>;
}

/** A 1px (or 2px when accent) dividing line. Full-bleed when vertical=false. */
export function Divider({ vertical, accent, thick, style }: Props) {
  const w = thick || accent ? borderWidth.thick : borderWidth.hairline;
  return (
    <View
      style={[
        vertical
          ? { width: w, alignSelf: "stretch", backgroundColor: accent ? colors.accent : colors.border }
          : { height: w, alignSelf: "stretch", backgroundColor: accent ? colors.accent : colors.border },
        style,
      ]}
    />
  );
}
