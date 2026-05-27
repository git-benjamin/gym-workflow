import Constants from "expo-constants";

export interface ToolCall {
  name: string;
  input: unknown;
  output: unknown;
}

export interface ChatTurn {
  role: "user" | "model";
  text: string;
  tool_calls?: ToolCall[];
  ts: string;
}

export interface ChatBubble {
  text: string;
  tool_calls: ToolCall[];
}

export interface ChatResponse {
  session_id: string;
  /** Joined view — kept for backwards-compat. */
  text: string;
  /** Visual bubbles — present on every modern server response. */
  messages: ChatBubble[];
  /** Aggregated tool calls across all bubbles. */
  tool_calls: ToolCall[];
}

export interface SessionSummary {
  session_id: string;
  updated_at: string;
  turns: number;
}

const apiUrl = (): string => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromExpo = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  return fromEnv ?? fromExpo ?? "http://localhost:3000";
};

const apiToken = (): string | undefined => process.env.EXPO_PUBLIC_API_TOKEN;

function authHeaders(): Record<string, string> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = apiToken();
  if (token) headers.authorization = `Bearer ${token}`;
  return headers;
}

async function jsonOrThrow<T>(r: Response, label: string): Promise<T> {
  const text = await r.text();
  if (!r.ok) {
    let msg = `${label} ${r.status}`;
    try {
      const body = JSON.parse(text) as { error?: string; retry_seconds?: number };
      if (body.error) msg += `: ${body.error}`;
      if (body.retry_seconds) msg += ` (retry in ~${Math.ceil(body.retry_seconds)}s)`;
    } catch {
      if (text) msg += `: ${text.slice(0, 300)}`;
    }
    throw new Error(msg);
  }
  return JSON.parse(text) as T;
}

export async function postChat(sessionId: string, message: string): Promise<ChatResponse> {
  const r = await fetch(`${apiUrl()}/api/chat`, {
    method: "POST",
    headers: authHeaders(),
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  return jsonOrThrow<ChatResponse>(r, "chat");
}

export async function listSessions(): Promise<SessionSummary[]> {
  const r = await fetch(`${apiUrl()}/api/chat/sessions`, { headers: authHeaders() });
  const body = await jsonOrThrow<{ sessions: SessionSummary[] }>(r, "list sessions");
  return body.sessions;
}

export async function loadSession(sessionId: string): Promise<ChatTurn[]> {
  const r = await fetch(
    `${apiUrl()}/api/chat/sessions/${encodeURIComponent(sessionId)}`,
    { headers: authHeaders() },
  );
  const body = await jsonOrThrow<{ session_id: string; turns: ChatTurn[] }>(r, "load session");
  return body.turns;
}

export interface ProposedSummary {
  exists: boolean;
  routine_title?: string;
  exercise_count?: number;
  file_modified_at?: string;
  file_size_bytes?: number;
}

export async function getProposedSummary(): Promise<ProposedSummary> {
  const r = await fetch(`${apiUrl()}/api/apply/proposed`, { headers: authHeaders() });
  return jsonOrThrow<ProposedSummary>(r, "load proposed");
}

export interface ApplyResponse {
  applied: boolean;
  routine_id: string;
  routine_title: string;
  duration_ms: number;
}

/** Push examples/proposed-routine-update.json directly to Hevy (bypass chat). */
export async function applyProposedToHevy(): Promise<ApplyResponse> {
  const r = await fetch(`${apiUrl()}/api/apply/proposed`, {
    method: "POST",
    headers: authHeaders(),
  });
  return jsonOrThrow<ApplyResponse>(r, "apply");
}
