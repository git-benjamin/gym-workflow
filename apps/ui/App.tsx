import { useState } from "react";
import { StatusBar } from "expo-status-bar";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { ChatScreen } from "./src/screens/ChatScreen";
import { SessionsScreen } from "./src/screens/SessionsScreen";

function makeSessionId(): string {
  // Sortable, no deps; good enough for a one-user app.
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

type View = "chat" | "sessions";

export default function App() {
  const [view, setView] = useState<View>("chat");
  const [sessionId, setSessionId] = useState<string>(() => makeSessionId());

  return (
    <SafeAreaProvider>
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
      <StatusBar style="auto" />
    </SafeAreaProvider>
  );
}
