import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ChannelInfo, UserInfo } from "../../adapters/types.js";
import { buildSessionPreamble, buildSystemPrompt, type Skill } from "../../core/prompt.js";
import type { WebTurnInput, WebTurnSettings } from "../../core/runtime-contract.js";
import type { SandboxConfig } from "../../sandbox.js";

type EdgeVerbosityLevel = boolean | "messages-only";

export interface EdgeTroublemakerExtensionContext {
	workspaceContext?: string;
	workspacePath?: string;
	channels?: ChannelInfo[];
	users?: UserInfo[];
	skills?: Skill[];
	channelName?: string;
	verbosity?: EdgeVerbosityLevel;
}

export interface EdgeTroublemakerTurn {
	systemPrompt: string;
	promptMessage: AgentMessage;
}

const EDGE_WORKSPACE_PATH = "/workspace";
const EDGE_SANDBOX_CONFIG: SandboxConfig = { type: "docker", container: "crawdad-cf" };

const WEB_CHAT_FORMAT_INSTRUCTIONS = `## Web Chat Formatting (Markdown)
You are responding via web chat. Use standard Markdown formatting.
Bold: **text**, Italic: *text*, Code: \`code\`, Block: \`\`\`code\`\`\`, Links: [text](url)
Keep responses concise and helpful.`;

function formatTimestamp(date: Date): string {
	const pad = (n: number) => n.toString().padStart(2, "0");
	const offset = -date.getTimezoneOffset();
	const offsetSign = offset >= 0 ? "+" : "-";
	const offsetHours = pad(Math.floor(Math.abs(offset) / 60));
	const offsetMins = pad(Math.abs(offset) % 60);
	return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}${offsetSign}${offsetHours}:${offsetMins}`;
}

export function createTroublemakerEdgeTurn(
	input: WebTurnInput,
	settings: WebTurnSettings | undefined,
	model: Model<Api>,
	context: EdgeTroublemakerExtensionContext = {},
	now = new Date(),
): EdgeTroublemakerTurn {
	const workspacePath = context.workspacePath || EDGE_WORKSPACE_PATH;
	const channelName = context.channelName || input.channelId || input.source || "web";
	const workspaceContext = context.workspaceContext || "Memory:\n(no working memory loaded)";
	const sessionPreamble = buildSessionPreamble(
		workspaceContext,
		context.channels ?? [],
		context.users ?? [],
		context.skills ?? [],
		input.channelId,
		channelName,
		context.verbosity,
	);
	const userName = input.source === "web" ? "user" : input.source || "user";
	const text = `${sessionPreamble}\n\n[${formatTimestamp(now)}] [${channelName}] [${userName}]: ${input.message}`;

	return {
		systemPrompt: settings?.systemPrompt || buildSystemPrompt(
			workspacePath,
			EDGE_SANDBOX_CONFIG,
			WEB_CHAT_FORMAT_INSTRUCTIONS,
			model,
		),
		promptMessage: {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: now.getTime(),
		} as AgentMessage,
	};
}
