import type { HostedWorkspaceToolName } from "../../core/hosted-workspace-tools.js";

export interface EdgeHostBridge {
	executeTool(tool: HostedWorkspaceToolName, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown>;
}
