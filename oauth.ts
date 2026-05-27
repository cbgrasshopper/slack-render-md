import { kv } from "./main.ts";
import type { AuthData } from "./main.ts";

export class OAuthHandler {
  private readonly clientId: string;
  private readonly clientSecret: string;
  private readonly redirectUri: string;
  private readonly botScopes: string;
  private readonly userScopes: string;

  constructor(
    clientId: string,
    clientSecret: string,
    redirectUri: string =
      "https://slack-render-md.aliveonline.deno.net/slack/oauth_redirect",
  ) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUri = redirectUri;

    this.botScopes = [
      "chat:write",
      "channels:history",
      "groups:history",
      "im:history",
      "mpim:history",
      "files:read",
    ].join(",");

    this.userScopes = [].join(",");
  }

  getInstallUrl(): string {
    if (!this.clientId) {
      throw new Error("SLACK_CLIENT_ID not configured");
    }

    return `https://slack.com/oauth/v2/authorize` +
      `?client_id=${this.clientId}` +
      `&redirect_uri=${encodeURIComponent(this.redirectUri)}` +
      `&scope=${this.botScopes}` +
      `&user_scope=${this.userScopes}`;
  }

  async handleCallback(code: string): Promise<AuthData | null> {
    if (!code) {
      throw new Error("Missing code parameter");
    }

    const resp = await fetch("https://slack.com/api/oauth.v2.access", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        code,
      }),
    });

    const data = await resp.json();
    if (!data.ok) {
      throw new Error(`OAuth failed: ${data.error}`);
    }

    const auth: AuthData = {
      botToken: data.access_token as string,
      userToken: (data.authed_user?.access_token as string) || "",
      userId: (data.authed_user?.id as string) || "",
      teamId: data.team?.id as string || "",
    };

    if (auth.userId && auth.userToken) {
      await kv.set(["auth", auth.userId], auth);
    }

    return auth;
  }
}
