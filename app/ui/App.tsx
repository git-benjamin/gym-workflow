import { useState } from "react";
import { ActivityIndicator, View } from "react-native";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";
import {
  InterTight_400Regular,
  InterTight_500Medium,
  InterTight_600SemiBold,
  InterTight_700Bold,
  InterTight_800ExtraBold,
} from "@expo-google-fonts/inter-tight";
import {
  JetBrainsMono_400Regular,
  JetBrainsMono_700Bold,
} from "@expo-google-fonts/jetbrains-mono";
import { useFonts } from "expo-font";

import { ChatScreen } from "./src/screens/ChatScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";
import { colors } from "./src/theme";

function makeSessionId(): string {
  // Sortable, no deps; good enough for a one-user app.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type ViewName = "chat" | "sessions";

export default function App() {
  const [view, setView] = useState<ViewName>("chat");
  const [sessionId, setSessionId] = useState<string>(() => makeSessionId());

  const [fontsLoaded] = useFonts({
    InterTight_400Regular,
    InterTight_500Medium,
    InterTight_600SemiBold,
    InterTight_700Bold,
    InterTight_800ExtraBold,
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
  });

  if (!fontsLoaded) {
    return (
      <SafeAreaProvider>
        <View style={{ flex: 1, backgroundColor: colors.background, alignItems: "center", justifyContent: "center" }}>
          <ActivityIndicator color={colors.accent} />
        </View>
        <StatusBar style="light" />
      </SafeAreaProvider>
    );
  }

  return (
    <SafeAreaProvider>
      <View style={{ flex: 1, backgroundColor: colors.background }}>
        {view === "sessions" ? (
          <SessionsScreen
            onClose={() => setView("chat")}
            onSelect={(id) => {
              setSessionId(id);
              setView("chat");
            }}
            onNewChat={() => {
              setSessionId(makeSessionId());
              setView("chat");
            }}
          />
        ) : (
          <ChatScreen
            sessionId={sessionId}
            onOpenSessions={() => setView("sessions")}
            onNewChat={() => setSessionId(makeSessionId())}
          />
        )}
      </View>
      <StatusBar style="light" />
    </SafeAreaProvider>
  );
}
