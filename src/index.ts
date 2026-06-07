export { createTroublemakerRuntime, type TroublemakerRuntime } from "./core/runtime.js";
export type { HostCapabilities, HostServices } from "./core/host.js";
export type { ExecutionHost, ToolRouteDecision, ToolRouteRequest, ToolRouter } from "./core/routing.js";
export type {
	RuntimeEventSink,
	RuntimeMode,
	RuntimeStreamEvent,
	WebTurnInput,
	WebTurnSettings,
} from "./core/runtime-contract.js";
export { runEdgeWebChat, runHostedEdgeTextTurn, type EdgeAgentMessage, type EdgeWebChatOptions, type EdgeWebChatResult, type HostedEdgeTextOptions, type HostedEdgeTextResult } from "./modes/edge/index.js";
export type { EdgeHostBridge } from "./modes/edge/host-bridge.js";
export {
	HOSTED_WORKSPACE_PATH,
	HOSTED_WORKSPACE_TOOL_NAMES,
	buildHostedWebSystemPrompt,
	buildHostedEmailSystemPrompt,
	hostedWorkspaceOpenAIToolDefinitions,
	hostedWorkspaceToolNames,
	normalizeHostedWorkspaceToolArgs,
} from "./core/hosted-workspace-tools.js";
export type { HostedWorkspaceToolName, NormalizeHostedWorkspaceToolArgsOptions } from "./core/hosted-workspace-tools.js";
export { createHostBashRoute } from "./modes/host/index.js";
export type { HostBashRequest, HostBashResponse, HostToolRequest, HostToolResponse } from "./modes/host/protocol.js";
export { composeEmailReplyBody, type EmailReplyQuote } from "./adapters/email/reply-composer.js";
export { buildReplyThreadHeaders, compileReferences, normalizeMessageIdForHeader, parseReferencesHeader } from "./adapters/email/thread-headers.js";
export {
	buildEmailConversationQuoteBody,
	buildEmailReplyQuoteFromThreadEvents,
	parseEmailThreadLedger,
	type EmailThreadQuoteCurrent,
	type EmailThreadQuoteEvent,
	type EmailThreadQuoteTurn,
} from "./adapters/email/thread-quote.js";
