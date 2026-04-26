import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { Button } from "../components/Button";
import { Divider } from "../components/Divider";
import { Text } from "../components/Text";
import { listSessions, type SessionSummary } from "../api";
import { borderWidth, colors, space } from "../theme";

interface Props {
  onSelect: (sessionId: string) => void;
  onClose: () => void;
  onNewChat: () => void;
}

function formatRelative(iso: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}

export function SessionsScreen({ onSelect, onClose, onNewChat }: Props) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setError(null);
      const list = await listSessions();
      setSessions(list);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  return (
    <SafeAreaView style={s.flex} edges={["top", "left", "right"]}>
      <View style={s.header}>
        <Pressable onPress={onClose} hitSlop={8} style={s.headerSide}>
          <Text variant="label" color="foreground">
            ← Back
          </Text>
        </Pressable>
        <Text variant="label" color="mutedForeground">
          Sessions
        </Text>
        <Pressable onPress={onNewChat} hitSlop={8} style={[s.headerSide, { alignItems: "flex-end" }]}>
          <Text variant="label" color="foreground">
            + New
          </Text>
        </Pressable>
      </View>
      <Divider />

      {loading ? (
        <ActivityIndicator color={colors.accent} style={s.loading} />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.session_id}
          contentContainerStyle={s.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              tintColor={colors.accent}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh();
                setRefreshing(false);
              }}
            />
          }
          ItemSeparatorComponent={() => <View style={{ height: space[3] }} />}
          ListHeaderComponent={
            <View style={s.intro}>
              <Text variant="display" align="left">
                History.
              </Text>
              <Text variant="lead" color="mutedForeground" style={s.introBody}>
                Past conversations with the coach. Tap any to continue, or start a new thread.
              </Text>
              <View style={s.introActions}>
                <Button variant="primary" onPress={onNewChat}>
                  New chat
                </Button>
              </View>
            </View>
          }
          ListEmptyComponent={
            <View style={s.empty}>
              <Text variant="body" color="mutedForeground" align="center">
                {error ? `Error: ${error}` : "No sessions yet."}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <Pressable style={s.row} onPress={() => onSelect(item.session_id)}>
              <View style={s.rowMain}>
                <Text variant="mono" numberOfLines={1}>
                  {item.session_id}
                </Text>
                <Text variant="label" color="mutedForeground" style={{ marginTop: space[1] }}>
                  {item.turns} {item.turns === 1 ? "turn" : "turns"} · {formatRelative(item.updated_at)}
                </Text>
              </View>
              <Text variant="label" color="accent">
                Open →
              </Text>
            </Pressable>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  header: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: space[5],
    paddingVertical: space[4],
    backgroundColor: colors.background,
    justifyContent: "space-between",
  },
  headerSide: { width: 80, justifyContent: "center" },

  list: {
    paddingHorizontal: space[5],
    paddingBottom: space[10],
  },
  intro: {
    paddingTop: space[8],
    paddingBottom: space[8],
  },
  introBody: { marginTop: space[3], maxWidth: 480 },
  introActions: { marginTop: space[5] },

  loading: { paddingVertical: space[16] },
  empty: { paddingVertical: space[16] },

  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: space[5],
    paddingVertical: space[5],
    borderWidth: borderWidth.hairline,
    borderColor: colors.border,
    backgroundColor: colors.card,
    gap: space[4],
  },
  rowMain: { flex: 1, minWidth: 0 },
});
