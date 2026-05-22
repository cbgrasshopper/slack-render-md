import { Manifest } from "deno-slack-sdk/mod.ts";
import RenderMdWorkflow from "./workflows/render_md_workflow.ts";

export default Manifest({
  name: "slack-render-md",
  description: "Renders Markdown files shared in Slack as rich HTML pages with diagrams and math",
  icon: "assets/default_new_app_icon.png",
  workflows: [RenderMdWorkflow],
  outgoingDomains: [
    "render-md.deno.dev",
    "slack.com",
    "cdn.jsdelivr.net",
  ],
  botScopes: [
    "channels:history",
    "groups:history",
    "im:history",
    "mpim:history",
    "files:read",
    "chat:write",
    "chat:write.public",
  ],
});
