/**
 * set_goal — agent tool to declare or update a goal in goal mode.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";
import * as log from "../log.js";
import { setGoal, isGoalActive } from "../goal/goal-state.js";

export function createSetGoalTool(workingDir: string): AgentTool<any> {
	const schema = Type.Object({
		description: Type.String({
			description:
				"A clear, specific description of the goal to accomplish. " +
				"Example: 'Create a new file src/utils/format.ts with a formatDuration function that converts seconds to HH:MM:SS format, write tests, and verify they pass.'",
		}),
		max_turns: Type.Optional(
			Type.Number({
				description: "Maximum number of agent turns before auto-abandon (default: 20).",
			}),
		),
	});

	return {
		name: "set_goal",
		label: "set_goal",
		description:
			"Declare a goal for autonomous goal mode. After you set a goal, the harness will " +
			"evaluate your progress after each turn and prompt you to continue if the goal " +
			"is not yet complete. Use complete_goal when done, or abandon_goal if the goal " +
			"is no longer achievable. Only available when goal mode is active (started via /goal command).",
		parameters: schema,
		execute: async (_toolCallId: string, params: unknown) => {
			const { description, max_turns } = params as { description: string; max_turns?: number };
			if (!isGoalActive(workingDir)) {
				return {
					content: [{
						type: "text" as const,
						text: "Goal mode is not active. Use the /goal command to start goal mode first, then call set_goal.",
					}],
					details: undefined,
				};
			}
			const state = setGoal(workingDir, description, max_turns);
			log.logInfo(`[set_goal] Goal set: "${description.substring(0, 80)}"`);
			return {
				content: [{
					type: "text" as const,
					text: `Goal set: "${description}"\n\nYou have ${state.maxTurns} turns to complete it. Work toward this goal using your tools. When done, call complete_goal with a summary.`,
				}],
				details: { goalId: state.id, maxTurns: state.maxTurns },
			};
		},
	};
}
