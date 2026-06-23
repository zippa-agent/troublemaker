/**
 * complete_goal — agent tool to mark the current goal as complete.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import * as log from "../log.js";
import { completeGoal, readGoalState } from "../goal/goal-state.js";

export function createCompleteGoalTool(workingDir: string): AgentTool<any> {
	const schema = Type.Object({
		summary: Type.String({
			description:
				"A summary of what was accomplished and how the goal was achieved.",
		}),
	});

	return {
		name: "complete_goal",
		label: "complete_goal",
		description:
			"Mark the current goal as complete. Call this when you have fully achieved " +
			"the goal you set with set_goal. Include a summary of what was accomplished.",
		parameters: schema,
		execute: async (_toolCallId: string, params: unknown) => {
			const { summary } = params as { summary: string };
			const state = readGoalState(workingDir);
			if (!state || state.status !== "active") {
				return {
					content: [{
						type: "text" as const,
						text: "No active goal to complete. Goal mode may not be active.",
					}],
					details: undefined,
				};
			}
			const completed = completeGoal(workingDir, summary);
			log.logInfo(`[complete_goal] Goal completed after ${completed?.turnCount ?? 0} turns`);
			return {
				content: [{
					type: "text" as const,
					text: `Goal completed successfully after ${completed?.turnCount ?? 0} turns.\n\nSummary: ${summary}`,
				}],
				details: { goalId: completed?.id, turnCount: completed?.turnCount },
				terminate: true,
			};
		},
	};
}
