import { Type } from "typebox";
import { bashToolSchema, DEFAULT_BASH_TIMEOUT_SECONDS } from "./tool-definitions.js";

export const HOSTED_WORKSPACE_PATH = "/data";

export const HOSTED_WORKSPACE_TOOL_NAMES = ["read", "write", "edit", "bash", "send_message", "list_channels", "read_thread"] as const;
export type HostedWorkspaceToolName = typeof HOSTED_WORKSPACE_TOOL_NAMES[number];

export const hostedReadToolSchema = Type.Object({
	label: Type.String({ description: "Brief user-facing reason for reading this file." }),
	path: Type.String({ description: "Workspace-relative path or absolute path under /data." }),
	offset: Type.Optional(Type.Number({ description: "Optional 1-indexed starting line." })),
	limit: Type.Optional(Type.Number({ description: "Optional maximum number of lines to read." })),
}, { additionalProperties: false });

export const hostedWriteToolSchema = Type.Object({
	label: Type.String({ description: "Brief user-facing description of what is being written." }),
	path: Type.String({ description: "Workspace-relative path or absolute path under /data." }),
	content: Type.String({ description: "Complete file content to write." }),
}, { additionalProperties: false });

export const hostedEditToolSchema = Type.Object({
	label: Type.String({ description: "Brief user-facing description of the edit." }),
	path: Type.String({ description: "Workspace-relative path or absolute path under /data." }),
	oldText: Type.String({ description: "Exact existing text to replace. Must match exactly and uniquely." }),
	newText: Type.String({ description: "Replacement text." }),
}, { additionalProperties: false });

export const hostedBashToolSchema = bashToolSchema;

export const hostedSendMessageToolSchema = Type.Object({
	label: Type.String({ description: "Brief user-facing description of the message being sent." }),
	target: Type.String({ description: "Required destination. Use list_channels for known targets. Examples: Telegram chat ID, Slack C/D/G ID, slack:<channel>:<thread_ts>, discord:<channel id>, email-user@example.com, phone-..." }),
	text: Type.String({ description: "Message text to send." }),
	attachments: Type.Optional(Type.Array(Type.String(), { description: "Email-only file paths to attach." })),
	subject: Type.Optional(Type.String({ description: "Email-only subject line." })),
}, { additionalProperties: false });

export const hostedListChannelsToolSchema = Type.Object({}, { additionalProperties: false });

export const hostedReadThreadToolSchema = Type.Object({
	target: Type.String({ description: "Slack thread target returned by list_channels, e.g. slack:C0AN1GL51K7:1779777014.658729." }),
	limit: Type.Optional(Type.Number({ description: "Maximum messages to return, default 40, max 100." })),
}, { additionalProperties: false });

const HOSTED_TOOL_DESCRIPTIONS: Record<HostedWorkspaceToolName, string> = {
	read: "Read a file from the hosted workspace. Supports optional 1-indexed line offset and maximum line limit.",
	write: "Write full content to a file in the hosted workspace, creating parent directories as needed.",
	edit: "Edit a hosted workspace file by replacing one exact text span.",
	bash: "Run a bounded bash command in the hosted workspace. Use for repository inspection, tests, builds, and verification.",
	send_message: "Send a user-visible message through Telegram, Slack, Discord, Email, or SMS/iMessage. Requires an explicit target; use list_channels first when unsure.",
	list_channels: "List known send_message targets and recent Slack thread targets from the host runtime.",
	read_thread: "Read a Slack thread transcript for a slack:<channel>:<thread_ts> target returned by list_channels.",
};

const HOSTED_TOOL_PARAMETERS: Record<HostedWorkspaceToolName, Record<string, unknown>> = {
	read: {
		type: "object",
		properties: {
			label: { type: "string", description: "Brief user-facing reason for reading this file." },
			path: { type: "string", description: "Workspace-relative path or absolute path under /data." },
			offset: { type: "number", description: "Optional 1-indexed starting line." },
			limit: { type: "number", description: "Optional maximum number of lines to read." },
		},
		required: ["label", "path"],
		additionalProperties: false,
	},
	write: {
		type: "object",
		properties: {
			label: { type: "string", description: "Brief user-facing description of what is being written." },
			path: { type: "string", description: "Workspace-relative path or absolute path under /data." },
			content: { type: "string", description: "Complete file content to write." },
		},
		required: ["label", "path", "content"],
		additionalProperties: false,
	},
	edit: {
		type: "object",
		properties: {
			label: { type: "string", description: "Brief user-facing description of the edit." },
			path: { type: "string", description: "Workspace-relative path or absolute path under /data." },
			oldText: { type: "string", description: "Exact existing text to replace. Must match exactly and uniquely." },
			newText: { type: "string", description: "Replacement text." },
		},
		required: ["label", "path", "oldText", "newText"],
		additionalProperties: false,
	},
	bash: {
		type: "object",
		properties: {
			label: { type: "string", description: "Brief user-facing description of what this command does." },
			command: { type: "string", description: "Bash command to execute." },
			timeout: { type: "number", description: "Optional timeout in seconds. Default is 60 seconds." },
		},
		required: ["label", "command"],
		additionalProperties: false,
	},
	send_message: {
		type: "object",
		properties: {
			label: { type: "string", description: "Brief user-facing description of the message being sent." },
			target: { type: "string", description: "Required destination. Use list_channels for known targets. Examples: Telegram chat ID, Slack C/D/G ID, slack:<channel>:<thread_ts>, discord:<channel id>, email-user@example.com, phone-..." },
			text: { type: "string", description: "Message text to send." },
			attachments: { type: "array", items: { type: "string" }, description: "Email-only file paths to attach." },
			subject: { type: "string", description: "Email-only subject line." },
		},
		required: ["label", "target", "text"],
		additionalProperties: false,
	},
	list_channels: {
		type: "object",
		properties: {},
		required: [],
		additionalProperties: false,
	},
	read_thread: {
		type: "object",
		properties: {
			target: { type: "string", description: "Slack thread target returned by list_channels, e.g. slack:C0AN1GL51K7:1779777014.658729." },
			limit: { type: "number", description: "Maximum messages to return, default 40, max 100." },
		},
		required: ["target"],
		additionalProperties: false,
	},
};

export function hostedWorkspaceToolNames(): HostedWorkspaceToolName[] {
	return [...HOSTED_WORKSPACE_TOOL_NAMES];
}

export function hostedWorkspaceToolDescription(name: HostedWorkspaceToolName): string {
	return HOSTED_TOOL_DESCRIPTIONS[name];
}

export function hostedWorkspaceToolSchema(name: HostedWorkspaceToolName) {
	switch (name) {
		case "read":
			return hostedReadToolSchema;
		case "write":
			return hostedWriteToolSchema;
		case "edit":
			return hostedEditToolSchema;
		case "bash":
			return hostedBashToolSchema;
		case "send_message":
			return hostedSendMessageToolSchema;
		case "list_channels":
			return hostedListChannelsToolSchema;
		case "read_thread":
			return hostedReadThreadToolSchema;
	}
}

export function hostedWorkspaceOpenAIToolDefinitions(): Array<Record<string, unknown>> {
	return HOSTED_WORKSPACE_TOOL_NAMES.map((name) => ({
		type: "function",
		name,
		description: HOSTED_TOOL_DESCRIPTIONS[name],
		parameters: HOSTED_TOOL_PARAMETERS[name],
	}));
}

export interface NormalizeHostedWorkspaceToolArgsOptions {
	defaultLabelPrefix?: string;
}

export function normalizeHostedWorkspaceToolArgs(
	tool: HostedWorkspaceToolName,
	args: Record<string, unknown>,
	options: NormalizeHostedWorkspaceToolArgsOptions = {},
): Record<string, unknown> {
	const normalized = { ...args };
	if (tool === "edit") {
		if (typeof normalized.oldText !== "string" && typeof normalized.old_text === "string") normalized.oldText = normalized.old_text;
		if (typeof normalized.newText !== "string" && typeof normalized.new_text === "string") normalized.newText = normalized.new_text;
	}
	if (tool === "send_message") {
		if (typeof normalized.target !== "string" && typeof normalized.channel === "string") normalized.target = normalized.channel;
		if (typeof normalized.text !== "string" && typeof normalized.message === "string") normalized.text = normalized.message;
	}
	if (tool === "read_thread" && typeof normalized.target !== "string" && typeof normalized.thread === "string") {
		normalized.target = normalized.thread;
	}
	if (tool === "bash" && typeof normalized.timeout !== "number") {
		normalized.timeout = DEFAULT_BASH_TIMEOUT_SECONDS;
	}
	if (tool !== "list_channels" && tool !== "read_thread" && (typeof normalized.label !== "string" || !normalized.label.trim())) {
		normalized.label = `${options.defaultLabelPrefix ?? "Hosted"} ${tool}`;
	}
	return normalized;
}

export interface HostedWebSystemPromptOptions {
	workspacePath?: string;
	availableTools?: readonly HostedWorkspaceToolName[];
}

function formatHostedToolNames(tools: readonly HostedWorkspaceToolName[]): string {
	return tools.length ? tools.map((tool) => `\`${tool}\``).join(", ") : "none";
}

function hostedToolUsageGuidance(tools: readonly HostedWorkspaceToolName[], normalReply: string): string {
	if (tools.length === 0) {
		return "No hosted tools are available for this turn. Answer from the supplied context. If the user explicitly needs files, shell commands, thread inspection, cross-channel delivery, attachments, or long-lived work, say that the request needs container escalation.";
	}

	const guidance: string[] = [];
	if (tools.includes("read")) guidance.push("use `read` before editing unknown files");
	if (tools.includes("edit")) guidance.push("use `edit` for exact replacements");
	if (tools.includes("write")) guidance.push("use `write` for complete file writes");
	if (tools.includes("bash")) guidance.push("use `bash` only for bounded inspection, tests, builds, and verification");
	if (tools.includes("list_channels")) guidance.push("use `list_channels` to discover explicit delivery targets");
	if (tools.includes("read_thread")) guidance.push("use `read_thread` to inspect Slack threads");
	if (tools.includes("send_message")) guidance.push(`use \`send_message\` only for explicit cross-channel delivery, not for ${normalReply}`);
	return guidance.join(", ") + ".";
}

function hostedRuntimePolicyBlock(
	workspacePath: string,
	tools: readonly HostedWorkspaceToolName[],
	normalReply: string,
): string {
	const toolNames = formatHostedToolNames(tools);
	if (tools.length === 0) {
		return `## Runtime
- The primary turn runs entirely in the Worker. No host/container tools are exposed for this turn.
- Ordinary assistant text is delivered as ${normalReply}.
- If a request requires workspace I/O, shell execution, platform channel lookup, Slack thread reads, explicit cross-channel delivery, attachments, shared-file ingestion, long-lived daemons, or unavailable host capabilities, explain that the request needs container escalation instead of guessing.

## Workspace
${workspacePath}/
├── awareness/context.jsonl    # Shared conversation context
├── awareness/scratch/         # Working notes
├── MEMORY.md                  # Persistent memory
├── BRIEF.md                   # Current operator-assigned brief, if present
├── settings.json              # Model and hosted runtime preferences
└── skills/                    # Custom skills with SKILL.md files

## Tools
Available hosted tools: none.
${hostedToolUsageGuidance(tools, normalReply)}`;
	}

	return `## Runtime
- The primary turn runs in the Worker. The container may wake only if you call one of the explicitly exposed host tools for this turn: ${toolNames}.
- The persistent workspace root is ${workspacePath}. Hosted tools run from that workspace and accept either relative paths or absolute paths under ${workspacePath}.
- Ordinary assistant text is delivered as ${normalReply}.
- If a request requires a host capability that is not exposed in this turn, explain that the request needs container escalation instead of guessing.

## Workspace
${workspacePath}/
├── awareness/context.jsonl    # Shared conversation context
├── awareness/scratch/         # Working notes
├── MEMORY.md                  # Persistent memory
├── BRIEF.md                   # Current operator-assigned brief, if present
├── settings.json              # Model and hosted runtime preferences
└── skills/                    # Custom skills with SKILL.md files

## Tools
Available hosted tools: ${toolNames}.
${hostedToolUsageGuidance(tools, normalReply)}`;
}

export function buildHostedWebSystemPrompt(options: HostedWebSystemPromptOptions = {}): string {
	const workspacePath = options.workspacePath || HOSTED_WORKSPACE_PATH;
	const tools = options.availableTools ?? HOSTED_WORKSPACE_TOOL_NAMES;
	return `## Context
- You are handling a TinyFat hosted web chat turn on the Cloudflare Worker edge.
- Each user message includes a <session_context> block with current memory, skills, and the channel being attended. Always use the latest one.
- This web chat shares awareness with container-backed channels through ${workspacePath}/awareness/context.jsonl.

## Web Chat Formatting (Markdown)
You are responding via web chat. Use standard Markdown formatting.
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Keep responses concise and helpful.

${hostedRuntimePolicyBlock(workspacePath, tools, "the normal web chat reply")}`;
}


export function buildHostedEmailSystemPrompt(options: HostedWebSystemPromptOptions = {}): string {
	const workspacePath = options.workspacePath || HOSTED_WORKSPACE_PATH;
	const tools = options.availableTools ?? HOSTED_WORKSPACE_TOOL_NAMES;
	return `## Context
- You are handling a TinyFat hosted email turn on the Cloudflare Worker edge.
- Each user message includes a <session_context> block with current memory, skills, and the email thread being attended. Always use the latest one.
- This email channel shares awareness with container-backed channels through ${workspacePath}/awareness/context.jsonl.

## Email Formatting (Markdown)
You are replying by email. Use standard Markdown formatting.
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Keep responses concise, complete, and professional. The user will receive one final email with your response.

${hostedRuntimePolicyBlock(workspacePath, tools, "the normal email reply")}`;
}
