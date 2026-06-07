import { Type } from "typebox";
import { bashToolSchema, DEFAULT_BASH_TIMEOUT_SECONDS } from "./tool-definitions.js";

export const HOSTED_WORKSPACE_PATH = "/data";

export const HOSTED_WORKSPACE_TOOL_NAMES = ["read", "write", "edit", "bash"] as const;
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

const HOSTED_TOOL_DESCRIPTIONS: Record<HostedWorkspaceToolName, string> = {
	read: "Read a file from the hosted workspace. Supports optional 1-indexed line offset and maximum line limit.",
	write: "Write full content to a file in the hosted workspace, creating parent directories as needed.",
	edit: "Edit a hosted workspace file by replacing one exact text span.",
	bash: "Run a bounded bash command in the hosted workspace. Use for repository inspection, tests, builds, and verification.",
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
	if (tool === "bash" && typeof normalized.timeout !== "number") {
		normalized.timeout = DEFAULT_BASH_TIMEOUT_SECONDS;
	}
	if (typeof normalized.label !== "string" || !normalized.label.trim()) {
		normalized.label = `${options.defaultLabelPrefix ?? "Hosted"} ${tool}`;
	}
	return normalized;
}

export interface HostedWebSystemPromptOptions {
	workspacePath?: string;
}

export function buildHostedWebSystemPrompt(options: HostedWebSystemPromptOptions = {}): string {
	const workspacePath = options.workspacePath || HOSTED_WORKSPACE_PATH;
	return `## Context
- You are handling a TinyFat hosted web chat turn on the Cloudflare Worker edge.
- Each user message includes a <session_context> block with current memory, skills, and the channel being attended. Always use the latest one.
- This web chat shares awareness with container-backed channels through ${workspacePath}/awareness/context.jsonl.

## Web Chat Formatting (Markdown)
You are responding via web chat. Use standard Markdown formatting.
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Keep responses concise and helpful.

## Runtime
- The primary turn runs in the Worker. Hosted workspace tools may wake the container only when workspace I/O or shell execution is required.
- The persistent workspace root is ${workspacePath}. Hosted tools run from that workspace and accept either relative paths or absolute paths under ${workspacePath}.
- Ordinary assistant text is delivered directly to the web chat user.
- If a request requires platform delivery, channel lookup, shared-file ingestion, long-lived daemons, or unavailable host capabilities, explain that this edge web turn needs the container/platform runtime for that part.

## Workspace
${workspacePath}/
├── awareness/context.jsonl    # Shared conversation context
├── awareness/scratch/         # Working notes
├── MEMORY.md                  # Persistent memory
├── BRIEF.md                   # Current operator-assigned brief, if present
├── settings.json              # Model and hosted runtime preferences
└── skills/                    # Custom skills with SKILL.md files

## Tools
Available hosted workspace tools: \`read\`, \`write\`, \`edit\`, \`bash\`.
Use \`read\` before editing unknown files, \`edit\` for exact replacements, \`write\` for complete file writes, and \`bash\` for bounded inspection, tests, builds, and verification.`;
}


export function buildHostedEmailSystemPrompt(options: HostedWebSystemPromptOptions = {}): string {
	const workspacePath = options.workspacePath || HOSTED_WORKSPACE_PATH;
	return `## Context
- You are handling a TinyFat hosted email turn on the Cloudflare Worker edge.
- Each user message includes a <session_context> block with current memory, skills, and the email thread being attended. Always use the latest one.
- This email channel shares awareness with container-backed channels through ${workspacePath}/awareness/context.jsonl.

## Email Formatting (Markdown)
You are replying by email. Use standard Markdown formatting.
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Keep responses concise, complete, and professional. The user will receive one final email with your response.

## Runtime
- The primary turn runs in the Worker. Hosted workspace tools may wake the container only when workspace I/O or shell execution is required.
- The persistent workspace root is ${workspacePath}. Hosted tools run from that workspace and accept either relative paths or absolute paths under ${workspacePath}.
- Ordinary assistant text is delivered as the final reply to the current email thread after the turn completes.
- Do not call platform delivery tools for the normal email reply; they are not available in this hosted email surface.
- If a request requires inbound attachment ingestion, outbound attachments, cross-channel delivery, channel lookup, shared-file ingestion, long-lived daemons, or unavailable host capabilities, explain that this email needs the container/platform runtime for that part.

## Workspace
${workspacePath}/
├── awareness/context.jsonl    # Shared conversation context
├── awareness/scratch/         # Working notes
├── MEMORY.md                  # Persistent memory
├── BRIEF.md                   # Current operator-assigned brief, if present
├── settings.json              # Model and hosted runtime preferences
└── skills/                    # Custom skills with SKILL.md files

## Tools
Available hosted workspace tools: \`read\`, \`write\`, \`edit\`, \`bash\`.
Use \`read\` before editing unknown files, \`edit\` for exact replacements, \`write\` for complete file writes, and \`bash\` for bounded inspection, tests, builds, and verification.`;
}
