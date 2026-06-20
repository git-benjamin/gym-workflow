/**
 * Receives Hevy webhook, validates auth, forwards to GitHub repository_dispatch.
 *
 * Env vars (bound via Terraform infra/cloudflare.tf):
 *   HEVY_WEBHOOK_AUTH  — the Authorization header value Hevy sends
 *   GH_PAT             — GitHub personal access token (repo scope)
 *   GH_REPO            — "owner/repo-name"
 */
export default {
  async fetch(request, env) {
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const auth = request.headers.get("Authorization") || "";
    if (auth !== env.HEVY_WEBHOOK_AUTH) {
      return new Response("Unauthorized", { status: 401 });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response("Bad request", { status: 400 });
    }

    const workoutId = body.workoutId;
    if (!workoutId) {
      return new Response("Missing workoutId", { status: 400 });
    }

    const ghResp = await fetch(
      `https://api.github.com/repos/${env.GH_REPO}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GH_PAT}`,
          Accept: "application/vnd.github+json",
          "Content-Type": "application/json",
          "User-Agent": "hevy-webhook-worker",
        },
        body: JSON.stringify({
          event_type: "hevy_workout_created",
          client_payload: { workoutId },
        }),
      }
    );

    if (!ghResp.ok) {
      const text = await ghResp.text();
      return new Response(`GitHub dispatch failed: ${text}`, { status: 502 });
    }

    return new Response("OK", { status: 200 });
  },
};
