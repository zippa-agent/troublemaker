import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
	HOSTED_WORKSPACE_TOOL_NAMES,
	hostedWorkspaceToolDescription,
	hostedWorkspaceToolSchema,
	normalizeHostedWorkspaceToolArgs,
	type HostedWorkspaceToolName,
} from "../../core/hosted-workspace-tools.js";
import type { EdgeHostBridge } from "./host-bridge.js";

interface ToolResultContent {
	type: string;
	text?: string;
}

interface HostedToolResult {
	content?: ToolResultContent[];
	details?: unknown;
}

function normalizeToolResult(result: unknown): any {
	if (result && typeof result === "object" && Array.isArray((result as HostedToolResult).content)) {
		return result as HostedToolResult;
	}
	if (typeof result === "string") {
		return { content: [{ type: "text", text: result }] };
	}
	return { content: [{ type: "text", text: JSON.stringify(result ?? null) }] };
}

function createEdgeHostedWorkspaceTool(name: HostedWorkspaceToolName, hostBridge: EdgeHostBridge): AgentTool<any> {
	return {
		name,
		label: name,
		description: hostedWorkspaceToolDescription(name),
		parameters: hostedWorkspaceToolSchema(name),
		executionMode: "sequential",
		execute: async (_toolCallId: string, input: unknown, signal?: AbortSignal) => {
			const args = normalizeHostedWorkspaceToolArgs(
				name,
				input && typeof input === "object" && !Array.isArray(input) ? input as Record<string, unknown> : {},
			);
			return normalizeToolResult(await hostBridge.executeTool(name, args, signal));
		},
	};
}

export interface CreateEdgeHostedWorkspaceToolsOptions {
	toolNames?: readonly HostedWorkspaceToolName[];
}

export function createEdgeHostedWorkspaceTools(
	hostBridge: EdgeHostBridge,
	options: CreateEdgeHostedWorkspaceToolsOptions = {},
): AgentTool<any>[] {
	const names = options.toolNames ?? HOSTED_WORKSPACE_TOOL_NAMES;
	return names.map((name) => createEdgeHostedWorkspaceTool(name, hostBridge));
}
