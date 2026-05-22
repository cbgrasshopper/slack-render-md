import type { Trigger } from "deno-slack-sdk/types.ts";
import { TriggerContextData, TriggerTypes } from "deno-slack-api/mod.ts";
import RenderMdWorkflow from "../workflows/render_md_workflow.ts";

const renderMdTrigger: Trigger<typeof RenderMdWorkflow.definition> = {
  type: TriggerTypes.Shortcut,
  name: "Render Markdown file",
  description: "Render a Markdown file as a rich HTML page",
  workflow: `#/workflows/${RenderMdWorkflow.definition.callback_id}`,
  inputs: {
    channel_id: {
      value: TriggerContextData.Shortcut.channel_id,
    },
    message_ts: {
      value: TriggerContextData.Shortcut.message_ts,
    },
    user_id: {
      value: TriggerContextData.Shortcut.user_id,
    },
    interactivity: {
      value: TriggerContextData.Shortcut.interactivity,
    },
  },
};

export default renderMdTrigger;
