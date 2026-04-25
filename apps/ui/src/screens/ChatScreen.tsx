import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";

import { loadSession, postChat, type ToolCall } from "../api";

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  toolCalls?: ToolCall[];
}

interface Props {
  sessionId: string;
  onOpenSessions: () => void;
  onNewChat: () => void;
}

export function ChatScreen({ sessionId, onOpenSessions, onNewChat }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const listRef = useRef<FlatList<Message>>(null);

  // Hydrate when session changes.
  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    setMessages([]);
    loadSession(sessionId)
      .then((turns) => {
        if (cancelled) return;
        setMessages(
          turns.map((t, i) => ({
            id: `${sessionId}-${i}`,
            role: t.role,
            text: t.text,
            toolCalls: t.tool_calls,
          })),
        );
      })
      .catch(() => {
        // Empty session is fine — server returns [] for unknown ids.
      })
      .finally(() => {
        if (!cancelled) setHydrating(false);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: false }), 50);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setSending(true);

    try {
      const resp = await postChat(sessionId, text);
      const modelMsg: Message = {
        id: `m-${Date.now()}`,
        role: "model",
        text: resp.text,
        toolCalls: resp.tool_calls?.length ? resp.tool_calls : undefined,
      };
      setMessages((m) => [...m, modelMsg]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        { id: `e-${Date.now()}`, role: "model", text: `Error: ${(err as Error).message}` },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [input, sending, sessionId]);

  return (
    <SafeAreaView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={onOpenSessions} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>≡ Sessions</Text>
        </Pressable>
        <Text style={styles.headerTitle} numberOfLines={1}>
          {sessionId}
        </Text>
        <Pressable onPress={onNewChat} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>+ New</Text>
        </Pressable>
      </View>

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            hydrating ? null : (
              <Text style={styles.empty}>Ask about your training — workouts, routines, trends, past reviews.</Text>
            )
          }
          renderItem={({ item }) => {
            const isUser = item.role === "user";
            return (
              <View
                style={[styles.bubble, isUser ? styles.bubbleUser : styles.bubbleModel]}
              >
                {item.toolCalls && item.toolCalls.length > 0 ? (
                  <View style={styles.toolCalls}>
                    {item.toolCalls.map((tc, i) => (
                      <Text key={i} style={styles.toolCall}>
                        → {tc.name}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {isUser ? (
                  <Text style={styles.userText}>{item.text}</Text>
                ) : (
                  <Markdown style={markdownStyles}>{item.text}</Markdown>
                )}
              </View>
            );
          }}
        />

        {(sending || hydrating) ? <ActivityIndicator style={styles.loading} /> : null}

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Ask about your training…"
            value={input}
            onChangeText={setInput}
            editable={!sending}
            multiline
          />
          <Pressable
            onPress={send}
            disabled={sending || !input.trim()}
            style={[styles.send, (sending || !input.trim()) && styles.sendDisabled]}
          >
            <Text style={styles.sendText}>Send</Text>
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: "#fafafa" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: "#e3e5e8",
    backgroundColor: "#fff",
  },
  headerBtn: { paddingHorizontal: 10, paddingVertical: 6 },
  headerBtnText: { color: "#1f6feb", fontWeight: "600", fontSize: 15 },
  headerTitle: { flex: 1, textAlign: "center", fontSize: 13, color: "#666", fontFamily: "Menlo" },
  list: { padding: 12, paddingBottom: 24, flexGrow: 1 },
  empty: { textAlign: "center", color: "#888", paddingVertical: 48, paddingHorizontal: 24 },
  bubble: {
    maxWidth: "85%",
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 8,
  },
  bubbleUser: { backgroundColor: "#1f6feb", alignSelf: "flex-end" },
  bubbleModel: { backgroundColor: "#e8eaee", alignSelf: "flex-start" },
  userText: { color: "#fff", fontSize: 15, lineHeight: 21 },
  toolCalls: { marginBottom: 6, gap: 2 },
  toolCall: {
    fontSize: 12,
    color: "#666",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  loading: { paddingVertical: 6 },
  composer: {
    flexDirection: "row",
    padding: 8,
    gap: 8,
    borderTopWidth: 1,
    borderColor: "#e3e5e8",
    backgroundColor: "#fff",
  },
  input: {
    flex: 1,
    maxHeight: 120,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    backgroundColor: "#f1f3f5",
    borderRadius: 10,
  },
  send: {
    paddingHorizontal: 18,
    paddingVertical: 10,
    backgroundColor: "#1f6feb",
    borderRadius: 10,
    justifyContent: "center",
  },
  sendDisabled: { backgroundColor: "#9bbcec" },
  sendText: { color: "#fff", fontWeight: "600" },
});

const markdownStyles = {
  body: { color: "#1f2328", fontSize: 15, lineHeight: 22 },
  paragraph: { marginTop: 0, marginBottom: 6 },
  heading1: { fontSize: 18, fontWeight: "700" as const, marginTop: 6, marginBottom: 4 },
  heading2: { fontSize: 17, fontWeight: "700" as const, marginTop: 6, marginBottom: 4 },
  heading3: { fontSize: 16, fontWeight: "600" as const, marginTop: 4, marginBottom: 4 },
  strong: { fontWeight: "700" as const },
  em: { fontStyle: "italic" as const },
  code_inline: {
    backgroundColor: "#dde0e4",
    paddingHorizontal: 4,
    borderRadius: 4,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
  },
  code_block: {
    backgroundColor: "#dde0e4",
    padding: 8,
    borderRadius: 6,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
  },
  fence: {
    backgroundColor: "#dde0e4",
    padding: 8,
    borderRadius: 6,
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
    fontSize: 13,
  },
  bullet_list: { marginVertical: 4 },
  ordered_list: { marginVertical: 4 },
  list_item: { marginVertical: 2 },
  table: { borderWidth: 1, borderColor: "#c8ccd1", borderRadius: 6 },
  th: { fontWeight: "700" as const, padding: 6 },
  td: { padding: 6 },
};
