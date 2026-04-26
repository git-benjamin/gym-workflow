import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from "react-native";
import Markdown from "react-native-markdown-display";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../components/Button";
import { Divider } from "../components/Divider";
import { Text } from "../components/Text";
import { loadSession, postChat, type ToolCall } from "../api";
import { borderWidth, colors, fonts, fontSize, layout, leading, space, tracking } from "../theme";

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

const COLLAPSE_PREVIEW_CHARS = 220;

const APPLY_PROMPT_RE = /##\s+Apply\??/i;

export function ChatScreen({ sessionId, onOpenSessions, onNewChat }: Props) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [hydrating, setHydrating] = useState(true);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const listRef = useRef<FlatList<Message>>(null);

  // ── Hydrate when session changes ───────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setHydrating(true);
    setMessages([]);
    setCollapsed({});
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

  // ── Send a message (also exposed for buttons that bypass the composer) ─
  const sendText = useCallback(
    async (text: string) => {
      if (!text || sending) return;
      const userMsg: Message = { id: `u-${Date.now()}`, role: "user", text };
      setMessages((m) => [...m, userMsg]);
      setSending(true);
      try {
        const resp = await postChat(sessionId, text);
        const incoming: Message[] = resp.messages.map((m, i) => ({
          id: `m-${Date.now()}-${i}`,
          role: "model",
          text: m.text,
          toolCalls: m.tool_calls?.length ? m.tool_calls : undefined,
        }));
        setMessages((m) => [...m, ...incoming]);
      } catch (err) {
        setMessages((m) => [
          ...m,
          { id: `e-${Date.now()}`, role: "model", text: `**Error:** ${(err as Error).message}` },
        ]);
      } finally {
        setSending(false);
        setTimeout(() => listRef.current?.scrollToEnd({ animated: true }), 60);
      }
    },
    [sending, sessionId],
  );

  const sendFromComposer = useCallback(async () => {
    const text = input.trim();
    if (!text) return;
    setInput("");
    await sendText(text);
  }, [input, sendText]);

  const reviewLatest = useCallback(() => sendText("review my latest workout"), [sendText]);
  const applyAmendments = useCallback(() => sendText("yes"), [sendText]);

  const toggleCollapse = (id: string) =>
    setCollapsed((c) => ({ ...c, [id]: !c[id] }));

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={s.flex} edges={["top", "left", "right"]}>
      {/* Header */}
      <View style={s.header}>
        <Pressable onPress={onOpenSessions} hitSlop={8} style={s.headerSide}>
          <Text variant="label" color="foreground">
            ≡ Sessions
          </Text>
        </Pressable>
        <View style={s.headerCenter}>
          <Text variant="label" color="mutedForeground" numberOfLines={1}>
            {sessionId}
          </Text>
        </View>
        <Pressable onPress={onNewChat} hitSlop={8} style={[s.headerSide, { alignItems: "flex-end" }]}>
          <Text variant="label" color="foreground">
            + New
          </Text>
        </Pressable>
      </View>
      <Divider />

      {/* Quick actions */}
      <View style={s.quickActions}>
        <Button
          variant="primary"
          size="md"
          onPress={reviewLatest}
          disabled={sending}
        >
          Review latest workout
        </Button>
      </View>
      <Divider />

      <KeyboardAvoidingView
        style={s.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
        keyboardVerticalOffset={Platform.OS === "ios" ? 0 : 0}
      >
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(m) => m.id}
          contentContainerStyle={s.list}
          ListEmptyComponent={
            hydrating ? null : (
              <View style={s.empty}>
                <Text variant="h2" align="center">
                  Ready.
                </Text>
                <Text variant="body" color="mutedForeground" align="center" style={s.emptyBody}>
                  Tap{" "}
                  <Text variant="body" color="accent">
                    Review latest workout
                  </Text>{" "}
                  above, or ask anything about your training.
                </Text>
              </View>
            )
          }
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              collapsed={!!collapsed[item.id]}
              onToggleCollapse={() => toggleCollapse(item.id)}
              onApply={applyAmendments}
              applying={sending}
            />
          )}
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
        />

        {sending || hydrating ? (
          <View style={s.loading}>
            <ActivityIndicator color={colors.accent} />
          </View>
        ) : null}

        <Divider />
        <View style={s.composer}>
          <TextInput
            style={s.input}
            placeholder="Ask about your training…"
            placeholderTextColor={colors.mutedForeground}
            value={input}
            onChangeText={setInput}
            editable={!sending}
            multiline
            blurOnSubmit={false}
            onKeyPress={(e: any) => {
              // Web only: Enter sends, Shift+Enter newline.
              if (Platform.OS === "web" && e?.nativeEvent?.key === "Enter" && !e.nativeEvent.shiftKey) {
                e.preventDefault?.();
                sendFromComposer();
              }
            }}
            onSubmitEditing={Platform.OS !== "web" ? sendFromComposer : undefined}
          />
          <Button
            variant="primary"
            size="md"
            onPress={sendFromComposer}
            disabled={sending || !input.trim()}
            loading={sending}
          >
            Send
          </Button>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// ── Message bubble ───────────────────────────────────────────────────────
function MessageBubble({
  message,
  collapsed,
  onToggleCollapse,
  onApply,
  applying,
}: {
  message: Message;
  collapsed: boolean;
  onToggleCollapse: () => void;
  onApply: () => void;
  applying: boolean;
}) {
  const isUser = message.role === "user";
  const isLong = message.text.length > COLLAPSE_PREVIEW_CHARS;
  const visibleText =
    collapsed && isLong ? `${message.text.slice(0, COLLAPSE_PREVIEW_CHARS).trimEnd()}…` : message.text;
  const showApply = !isUser && APPLY_PROMPT_RE.test(message.text);

  return (
    <View style={[s.bubbleRow, isUser ? s.bubbleRowUser : s.bubbleRowModel]}>
      <View
        style={[
          s.bubble,
          isUser ? s.bubbleUser : s.bubbleModel,
        ]}
      >
        {/* Tool-call trace (model only) */}
        {!isUser && message.toolCalls && message.toolCalls.length > 0 ? (
          <View style={s.toolCalls}>
            {message.toolCalls.map((tc, i) => (
              <Text key={i} variant="label" color="mutedForeground">
                → {tc.name}
              </Text>
            ))}
          </View>
        ) : null}

        {/* Body */}
        {isUser ? (
          <Text variant="body" color="userBubbleText" style={s.bubbleText}>
            {visibleText}
          </Text>
        ) : (
          <Markdown style={markdownStyles as any}>{visibleText}</Markdown>
        )}

        {/* Footer row: collapse toggle + apply button (model only) */}
        {(isLong || showApply) && (
          <View style={s.bubbleFooter}>
            {isLong ? (
              <Pressable onPress={onToggleCollapse} hitSlop={6}>
                <Text variant="label" color={isUser ? "userBubbleText" : "mutedForeground"}>
                  {collapsed ? "+ Expand" : "− Collapse"}
                </Text>
              </Pressable>
            ) : (
              <View />
            )}
            {showApply && !collapsed ? (
              <Button variant="primary" size="sm" onPress={onApply} disabled={applying}>
                Apply amendments
              </Button>
            ) : null}
          </View>
        )}
      </View>
    </View>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    backgroundColor: colors.background,
  },
  headerSide: { width: 110, justifyContent: "center" },
  headerCenter: { flex: 1, alignItems: "center" },

  quickActions: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    gap: space[5],
    backgroundColor: colors.background,
  },

  list: {
    paddingHorizontal: space[5],
    paddingVertical: space[6],
    flexGrow: 1,
  },
  empty: { flex: 1, justifyContent: "center", paddingVertical: space[16] },
  emptyBody: { marginTop: space[4], maxWidth: 320, alignSelf: "center" },

  bubbleRow: { flexDirection: "row" },
  bubbleRowUser: { justifyContent: "flex-end" },
  bubbleRowModel: { justifyContent: "flex-start" },
  bubble: {
    maxWidth: layout.bubbleMaxWidth,
    paddingVertical: space[4],
    paddingHorizontal: space[5],
    borderWidth: borderWidth.hairline,
  },
  bubbleUser: {
    backgroundColor: colors.userBubble,
    borderColor: colors.userBubble,
  },
  bubbleModel: {
    backgroundColor: colors.modelBubble,
    borderColor: colors.border,
  },
  bubbleText: {},
  toolCalls: {
    paddingBottom: space[3],
    marginBottom: space[3],
    borderBottomWidth: borderWidth.hairline,
    borderBottomColor: colors.border,
    gap: space[1],
  },
  bubbleFooter: {
    marginTop: space[4],
    paddingTop: space[3],
    borderTopWidth: borderWidth.hairline,
    borderTopColor: colors.border,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: space[3],
  },

  loading: { paddingVertical: space[3], alignItems: "center" },

  composer: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: space[4],
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    paddingBottom: space[6],
    backgroundColor: colors.background,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    paddingHorizontal: space[4],
    paddingVertical: space[3],
    fontSize: fontSize.base,
    fontFamily: fonts.sans,
    backgroundColor: colors.input,
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    color: colors.foreground,
  },
});

// ── Markdown style map (mirrors design tokens) ───────────────────────────
const baseLine = { lineHeight: fontSize.base * leading.normal };
const markdownStyles = {
  body: {
    color: colors.foreground,
    fontFamily: fonts.sans,
    fontSize: fontSize.base,
    ...baseLine,
  },
  paragraph: { marginTop: 0, marginBottom: space[3] },
  heading1: {
    color: colors.foreground,
    fontFamily: fonts.sansBold,
    fontSize: fontSize["2xl"],
    letterSpacing: tracking.tight * fontSize["2xl"],
    lineHeight: fontSize["2xl"] * leading.tight,
    marginTop: space[2],
    marginBottom: space[3],
  },
  heading2: {
    color: colors.foreground,
    fontFamily: fonts.sansBold,
    fontSize: fontSize.xl,
    letterSpacing: tracking.tight * fontSize.xl,
    lineHeight: fontSize.xl * leading.tight,
    marginTop: space[3],
    marginBottom: space[2],
  },
  heading3: {
    color: colors.foreground,
    fontFamily: fonts.sansSemibold,
    fontSize: fontSize.lg,
    letterSpacing: tracking.tight * fontSize.lg,
    lineHeight: fontSize.lg * leading.snug,
    marginTop: space[3],
    marginBottom: space[2],
  },
  strong: { fontFamily: fonts.sansSemibold, color: colors.foreground },
  em: { fontStyle: "italic" as const },
  link: { color: colors.accent, textDecorationLine: "underline" as const },
  code_inline: {
    backgroundColor: colors.muted,
    color: colors.accent,
    paddingHorizontal: 4,
    fontFamily: fonts.mono,
    fontSize: fontSize.sm,
  },
  code_block: {
    backgroundColor: colors.muted,
    color: colors.foreground,
    padding: space[3],
    fontFamily: fonts.mono,
    fontSize: fontSize.sm,
  },
  fence: {
    backgroundColor: colors.muted,
    color: colors.foreground,
    padding: space[3],
    fontFamily: fonts.mono,
    fontSize: fontSize.sm,
  },
  blockquote: {
    backgroundColor: colors.muted,
    borderLeftWidth: borderWidth.thick,
    borderLeftColor: colors.accent,
    paddingHorizontal: space[3],
    paddingVertical: space[2],
    marginVertical: space[2],
  },
  bullet_list: { marginVertical: space[1] },
  ordered_list: { marginVertical: space[1] },
  list_item: { marginVertical: space[1] },
  hr: {
    backgroundColor: colors.border,
    height: 1,
    marginVertical: space[3],
  },
  table: {
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
  },
  thead: { backgroundColor: colors.muted },
  th: {
    fontFamily: fonts.sansSemibold,
    color: colors.foreground,
    padding: space[2],
  },
  td: {
    color: colors.foreground,
    padding: space[2],
  },
};
