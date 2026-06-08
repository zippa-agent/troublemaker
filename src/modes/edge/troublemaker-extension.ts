import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { Api, Model } from "@earendil-works/pi-ai";
import type { ChannelInfo, UserInfo } from "../../adapters/types.js";
import { buildHostedWebSystemPrompt, HOSTED_WORKSPACE_PATH, type HostedWorkspaceToolName } from "../../core/hosted-workspace-tools.js";
import { buildSessionPreamble, type Skill } from "../../core/prompt.js";
import type { WebTurnInput, WebTurnSettings } from "../../core/runtime-contract.js";

type EdgeVerbosityLevel = boolean | "messages-only";

export interface EdgeTroublemakerExtensionContext {
	workspaceContext?: string;
	workspacePath?: string;
	channels?: ChannelInfo[];
	users?: UserInfo[];
	skills?: Skill[];
	channelName?: string;
	hostToolNames?: readonly HostedWorkspaceToolName[];
	verbosity?: EdgeVerbosityLevel;
}

export interface EdgeTroublemakerTurn {
	systemPrompt: string;
	promptMessage: AgentMessage;
}

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
	_model: Model<Api>,
	context: EdgeTroublemakerExtensionContext = {},
	now = new Date(),
): EdgeTroublemakerTurn {
	const workspacePath = context.workspacePath || HOSTED_WORKSPACE_PATH;
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
		systemPrompt: settings?.systemPrompt || buildHostedWebSystemPrompt({ workspacePath, availableTools: context.hostToolNames }),
		promptMessage: {
			role: "user",
			content: [{ type: "text", text }],
			timestamp: now.getTime(),
		} as AgentMessage,
	};
}
