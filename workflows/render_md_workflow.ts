import { DefineWorkflow, Schema } from "deno-slack-sdk/mod.ts";
import { RenderMdFunctionDefinition } from "../functions/render_md.ts";

const RenderMdWorkflow = DefineWorkflow({
  callback_id: "render_md_workflow",
  title: "Render Markdown file",
  description: "Fetches a Markdown file from Slack and renders it as HTML",
  input_parameters: {
    properties: {
      interactivity: {
        type: Schema.slack.types.interactivity,
      },
      channel_id: {
        type: Schema.slack.types.channel_id,
      },
      message_ts: {
        type: Schema.types.string,
      },
      user_id: {
        type: Schema.slack.types.user_id,
      },
    },
    required: ["interactivity", "channel_id", "message_ts", "user_id"],
  },
});

RenderMdWorkflow.addStep(RenderMdFunctionDefinition, {
  channel_id: RenderMdWorkflow.inputs.channel_id,
  message_ts: RenderMdWorkflow.inputs.message_ts,
  user_id: RenderMdWorkflow.inputs.user_id,
  interactivity: RenderMdWorkflow.inputs.interactivity,
});

export default RenderMdWorkflow;
