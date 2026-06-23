/**
 * abandon_goal — agent tool to abandon the current goal.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import * as log from "../log.js";
import { abandonGoal, readGoalState } from "../goal/goal-state.js";

export function createAbandonGoalTool(workingDir: string): AgentTool<any> {
	const schema = Type.Object({
		reason: Type.String({
			description: "Why the goal is being abandoned. Be specific about what prevented completion.",
		}),
	});

	return {
		name: "abandon_goal",
		label: "abandon_goal",
		description:
			"Abandon the current goal. Call this if the goal is no longer achievable, " +
			"relevant, or if continuing would be counterproductive. Include a reason.",
		parameters: schema,
		execute: async (_toolCallId: string, params: unknown) => {
			const { reason } = params as { reason: string };
			const state = readGoalState(workingDir);
			if (!state || state.status !== "active") {
				return {
					content: [{
						type: "text" as const,
						text: "No active goal to abandon. Goal mode may not be active.",
					}],
					details: undefined,
				};
			}
			const abandoned = abandonGoal(workingDir, reason);
			log.logInfo(`[abandon_goal] Goal abandoned: ${reason}`);
			return {
				content: [{
					type: "text" as const,
					text: `Goal abandoned after ${abandoned?.turnCount ?? 0} turns.\nReason: ${reason}`,
				}],
				details: { goalId: abandoned?.id, turnCount: abandoned?.turnCount },
				terminate: true,
			};
		},
	};
}
