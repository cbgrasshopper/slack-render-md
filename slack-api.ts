interface SlackApiResponse {
  ok: boolean;
  [key: string]: unknown;
}

export class SlackApi {
  private readonly token: string;

  constructor(token: string) {
    this.token = token;
  }

  async callApi(
    method: string,
    data: Record<string, unknown>,
  ): Promise<SlackApiResponse> {
    const body = new URLSearchParams();
    for (const [key, value] of Object.entries(data)) {
      body.set(
        key,
        typeof value === "object" ? JSON.stringify(value) : String(value),
      );
    }
    const resp = await fetch(`https://slack.com/api/${method}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    return (await resp.json()) as SlackApiResponse;
  }

  async getConversationHistory(
    channelId: string,
    messageTs: string,
  ): Promise<
    { messages: Array<Record<string, unknown>> | null; error?: string }
  > {
    const resp = await this.callApi("conversations.history", {
      channel: channelId,
      latest: messageTs,
      limit: 1,
      inclusive: true,
    });
    if (!resp.ok || !resp.messages) {
      console.error("conversations.history failed:", resp);
      return { messages: null, error: String(resp.error || "unknown") };
    }
    return { messages: resp.messages as Array<Record<string, unknown>> };
  }

  async openView(
    triggerId: string,
    view: unknown,
  ): Promise<void> {
    const resp = await this.callApi("views.open", {
      trigger_id: triggerId,
      view,
    });
    if (!resp.ok) {
      console.error("views.open error:", resp);
    }
  }

  async updateView(
    viewId: string,
    view: unknown,
  ): Promise<void> {
    const resp = await this.callApi("views.update", {
      view_id: viewId,
      view,
    });
    if (!resp.ok) {
      console.error("views.update error:", resp);
    }
  }
}
