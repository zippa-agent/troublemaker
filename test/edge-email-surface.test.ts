import assert from "node:assert/strict";
import {
	HOSTED_WORKSPACE_PATH,
	buildHostedEmailSystemPrompt,
	hostedWorkspaceOpenAIToolDefinitions,
} from "../src/core/hosted-workspace-tools.js";

const prompt = buildHostedEmailSystemPrompt();

assert.match(prompt, /hosted email turn on the Cloudflare Worker edge/);
assert.match(prompt, /Ordinary assistant text is delivered as the final reply to the current email thread/);
assert.match(prompt, /Do not call `send_message` for the normal reply to the current email thread/);
assert.match(prompt, /Available hosted tools: `read`, `write`, `edit`, `bash`, `list_channels`, `read_thread`, `send_message`/);
assert.match(prompt, /\/data\/awareness\/context\.jsonl/);
assert.doesNotMatch(prompt, /\/workspace/);
assert.doesNotMatch(prompt, /\b(?:yield_no_action|attach)\b/);
assert.equal(HOSTED_WORKSPACE_PATH, "/data");
assert.deepEqual(hostedWorkspaceOpenAIToolDefinitions().map((tool) => tool.name), ["read", "write", "edit", "bash", "send_message", "list_channels", "read_thread"]);

console.log("edge email surface ok");
