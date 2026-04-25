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

export interface ChatResponse {
  session_id: string;
  text: string;
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
  if (!r.ok) throw new Error(`${label} ${r.status}: ${await r.text()}`);
  return (await r.json()) as T;
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
