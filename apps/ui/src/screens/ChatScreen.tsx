import { useCallback, useRef, useState } from "react";
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
import { SafeAreaView } from "react-native-safe-area-context";

import { postChat } from "../api";

interface Message {
  id: string;
  role: "user" | "model";
  text: string;
  toolCalls?: Array<{ name: string; output: unknown }>;
}

const SESSION_ID = `local-${new Date().toISOString().slice(0, 10)}`;

export function ChatScreen() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<FlatList<Message>>(null);

  const send = useCallback(async () => {
    const text = input.trim();
    if (!text || sending) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      text,
    };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setSending(true);

    try {
      const resp = await postChat(SESSION_ID, text);
      const modelMsg: Message = {
        id: `m-${Date.now()}`,
        role: "model",
        text: resp.text,
        toolCalls: resp.tool_calls?.length
          ? resp.tool_calls.map((tc) => ({ name: tc.name, output: tc.output }))
          : undefined,
      };
      setMessages((m) => [...m, modelMsg]);
    } catch (err) {
      setMessages((m) => [
        ...m,
        {
          id: `e-${Date.now()}`,
          role: "model",
          text: `Error: ${(err as Error).message}`,
        },
      ]);
    } finally {
      setSending(false);
      setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 50);
    }
  }, [input, sending]);

  return (
    <SafeAreaView style={styles.flex}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <View
              style={[
                styles.bubble,
                item.role === "user" ? styles.bubbleUser : styles.bubbleModel,
              ]}
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
              <Text style={styles.bubbleText}>{item.text}</Text>
            </View>
          )}
        />

        {sending ? <ActivityIndicator style={styles.loading} /> : null}

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
  list: { padding: 12, paddingBottom: 24 },
  bubble: {
    maxWidth: "85%",
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 14,
    marginBottom: 8,
  },
  bubbleUser: {
    backgroundColor: "#1f6feb",
    alignSelf: "flex-end",
  },
  bubbleModel: {
    backgroundColor: "#e8eaee",
    alignSelf: "flex-start",
  },
  bubbleText: {
    color: undefined,
    fontSize: 15,
    lineHeight: 21,
  },
  toolCalls: {
    marginBottom: 6,
    gap: 2,
  },
  toolCall: {
    fontSize: 12,
    color: "#666",
    fontFamily: Platform.select({ ios: "Menlo", android: "monospace", default: "monospace" }),
  },
  loading: {
    paddingVertical: 6,
  },
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
  sendDisabled: {
    backgroundColor: "#9bbcec",
  },
  sendText: {
    color: "#fff",
    fontWeight: "600",
  },
});
