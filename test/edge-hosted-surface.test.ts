import assert from "node:assert/strict";
import {
	HOSTED_WORKSPACE_PATH,
	HOSTED_WORKSPACE_TOOL_NAMES,
	buildHostedWebSystemPrompt,
	hostedWorkspaceOpenAIToolDefinitions,
	normalizeHostedWorkspaceToolArgs,
} from "../src/core/hosted-workspace-tools.js";
import { createTroublemakerEdgeTurn } from "../src/modes/edge/troublemaker-extension.js";

const model = {
	id: "test-model",
	name: "test-model",
	api: "openai-completions",
	provider: "test",
	baseUrl: "https://example.test/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 1024,
	maxTokens: 128,
} as any;

const prompt = buildHostedWebSystemPrompt();
assert.match(prompt, /Cloudflare Worker edge/);
assert.match(prompt, /Available hosted tools: `read`, `write`, `edit`, `bash`, `list_channels`, `read_thread`, `send_message`/);
assert.match(prompt, /send_message` only when a user-visible message should be delivered outside the current web chat/);
assert.match(prompt, /slack:<channel>:<thread_ts>/);
assert.match(prompt, /\/data\/awareness\/context\.jsonl/);
assert.doesNotMatch(prompt, /\/workspace/);
assert.doesNotMatch(prompt, /yield_no_action|attach/);
assert.equal(HOSTED_WORKSPACE_PATH, "/data");
assert.deepEqual(HOSTED_WORKSPACE_TOOL_NAMES, ["read", "write", "edit", "bash", "send_message", "list_channels", "read_thread"]);
assert.deepEqual(hostedWorkspaceOpenAIToolDefinitions().map((tool) => tool.name), ["read", "write", "edit", "bash", "send_message", "list_channels", "read_thread"]);

const turn = createTroublemakerEdgeTurn(
	{ message: "read the scheduling skill", channelId: "web", source: "web" },
	{},
	model,
	{
		workspacePath: HOSTED_WORKSPACE_PATH,
		workspaceContext: "Memory:\nZip remembers edge mode.",
		skills: [{
			name: "scheduling",
			description: "Manage calendar and attention items",
			filePath: "/data/skills/scheduling/SKILL.md",
		}],
	},
	new Date("2026-06-07T07:05:00.000Z"),
);

assert.match(turn.systemPrompt, /\/data/);
assert.doesNotMatch(turn.systemPrompt, /\/workspace/);
const text = turn.promptMessage.content[0].type === "text" ? turn.promptMessage.content[0].text : "";
assert.match(text, /<session_context>/);
assert.match(text, /\/data\/skills\/scheduling\/SKILL\.md/);
assert.doesNotMatch(text, /\/workspace/);

assert.deepEqual(
	normalizeHostedWorkspaceToolArgs("edit", { path: "x", old_text: "old", new_text: "new" }),
	{ path: "x", old_text: "old", new_text: "new", oldText: "old", newText: "new", label: "Hosted edit" },
);
assert.deepEqual(
	normalizeHostedWorkspaceToolArgs("bash", { command: "pwd" }),
	{ command: "pwd", timeout: 60, label: "Hosted bash" },
);
assert.deepEqual(
	normalizeHostedWorkspaceToolArgs("send_message", { channel: "C123", message: "hello" }),
	{ channel: "C123", message: "hello", target: "C123", text: "hello", label: "Hosted send_message" },
);
assert.deepEqual(
	normalizeHostedWorkspaceToolArgs("list_channels", {}),
	{},
);
assert.deepEqual(
	normalizeHostedWorkspaceToolArgs("read_thread", { thread: "slack:C123:1779777014.658729" }),
	{ thread: "slack:C123:1779777014.658729", target: "slack:C123:1779777014.658729" },
);

console.log("edge hosted surface ok");
