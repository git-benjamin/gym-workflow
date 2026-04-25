import Constants from "expo-constants";

interface ChatResponse {
  session_id: string;
  text: string;
  tool_calls: Array<{ name: string; input: unknown; output: unknown }>;
}

const apiUrl = (): string => {
  const fromEnv = process.env.EXPO_PUBLIC_API_URL;
  const fromExpo = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;
  return fromEnv ?? fromExpo ?? "http://localhost:3000";
};

const apiToken = (): string | undefined => process.env.EXPO_PUBLIC_API_TOKEN;

export async function postChat(sessionId: string, message: string): Promise<ChatResponse> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const token = apiToken();
  if (token) headers.authorization = `Bearer ${token}`;

  const r = await fetch(`${apiUrl()}/api/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session_id: sessionId, message }),
  });
  if (!r.ok) {
    throw new Error(`chat ${r.status}: ${await r.text()}`);
  }
  return (await r.json()) as ChatResponse;
}
