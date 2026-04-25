import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

import { listSessions, type SessionSummary } from "../api";

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
    <SafeAreaView style={styles.flex}>
      <View style={styles.header}>
        <Pressable onPress={onClose} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>← Back</Text>
        </Pressable>
        <Text style={styles.headerTitle}>Sessions</Text>
        <Pressable onPress={onNewChat} style={styles.headerBtn}>
          <Text style={styles.headerBtnText}>+ New</Text>
        </Pressable>
      </View>

      {loading ? (
        <ActivityIndicator style={styles.loading} />
      ) : (
        <FlatList
          data={sessions}
          keyExtractor={(s) => s.session_id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={async () => {
                setRefreshing(true);
                await refresh();
                setRefreshing(false);
              }}
            />
          }
          ListEmptyComponent={
            <Text style={styles.empty}>
              {error ? `Error: ${error}` : "No sessions yet. Start a new chat."}
            </Text>
          }
          renderItem={({ item }) => (
            <Pressable style={styles.row} onPress={() => onSelect(item.session_id)}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {item.session_id}
              </Text>
              <Text style={styles.rowMeta}>
                {item.turns} {item.turns === 1 ? "turn" : "turns"} · {formatRelative(item.updated_at)}
              </Text>
            </Pressable>
          )}
        />
      )}
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
  headerTitle: { flex: 1, textAlign: "center", fontSize: 17, fontWeight: "600" },
  list: { padding: 12 },
  loading: { paddingVertical: 32 },
  empty: { textAlign: "center", color: "#666", paddingVertical: 32 },
  row: {
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderRadius: 10,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#e3e5e8",
    marginBottom: 8,
  },
  rowTitle: { fontSize: 15, fontFamily: "Menlo" },
  rowMeta: { fontSize: 13, color: "#666", marginTop: 4 },
});
