import { DefineFunction, Schema, SlackFunction } from "deno-slack-sdk/mod.ts";

export const RenderMdFunctionDefinition = DefineFunction({
  callback_id: "render_md",
  title: "Render Markdown",
  description: "Fetches a Markdown file from Slack, renders it, and returns a URL",
  source_file: "functions/render_md.ts",
  input_parameters: {
    properties: {
      channel_id: {
        type: Schema.slack.types.channel_id,
      },
      message_ts: {
        type: Schema.types.string,
      },
      user_id: {
        type: Schema.slack.types.user_id,
      },
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
    },
    required: ["channel_id", "message_ts", "user_id", "interactivity"],
  },
  output_parameters: {
    properties: {},
    required: [],
  },
});

const RENDERER_URL = Deno.env.get("RENDERER_URL") ||
  "https://slack-render-md.aliveonline.deno.net";

export default SlackFunction(
  RenderMdFunctionDefinition,
  async ({ inputs, client, env }) => {
    const { channel_id, message_ts, user_id } = inputs;

    const history = await client.conversations.history({
      channel: channel_id,
      latest: message_ts,
      limit: 1,
      inclusive: true,
    });

    if (!history.ok || !history.messages || history.messages.length === 0) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "Could not fetch the message. Make sure I have access to this channel.",
      });
      return { outputs: {} };
    }

    const message = history.messages[0];
    const files = message.files || [];

    const mdFiles = files.filter((f: Record<string, unknown>) =>
      typeof f.name === "string" &&
        (f.name.endsWith(".md") || f.name.endsWith(".markdown")) ||
      f.filetype === "markdown" || f.mimetype === "text/markdown"
    );

    if (mdFiles.length === 0) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: "No Markdown files found in this message.",
      });
      return { outputs: {} };
    }

    const file = mdFiles[0];

    const fileInfo = await client.files.info({ file: file.id });

    if (!fileInfo.ok || !fileInfo.file) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: `Could not get info for file "${file.name}".`,
      });
      return { outputs: {} };
    }

    const downloadUrl = fileInfo.file.url_private_download ||
      fileInfo.file.url_private;

    if (!downloadUrl) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: `Could not get download URL for "${file.name}".`,
      });
      return { outputs: {} };
    }

    const token = env["SLACK_BOT_TOKEN"];

    const renderResponse = await fetch(`${RENDERER_URL}/api/render`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filename: file.name || "document.md",
        download_url: downloadUrl,
        token,
      }),
    });

    if (!renderResponse.ok) {
      await client.chat.postEphemeral({
        channel: channel_id,
        user: user_id,
        text: `Failed to render "${file.name}". The renderer service returned an error.`,
      });
      return { outputs: {} };
    }

    const { id } = await renderResponse.json();
    const renderUrl = `${RENDERER_URL}/render/${id}`;

    await client.chat.postEphemeral({
      channel: channel_id,
      user: user_id,
      text: `Rendered "${file.name}"`,
      blocks: [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `*Rendered:* ${file.name}`,
          },
        },
        {
          type: "actions",
          elements: [
            {
              type: "button",
              text: {
                type: "plain_text",
                text: "Open rendered Markdown",
              },
              url: renderUrl,
              action_id: "open_rendered",
            },
          ],
        },
      ],
    });

    return { outputs: {} };
  },
);
