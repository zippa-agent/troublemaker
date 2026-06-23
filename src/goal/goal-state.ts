/**
 * Goal mode state management.
 *
 * When goal mode is active, the agent works autonomously toward a declared
 * goal. After each turn, the harness evaluates whether the goal is complete
 * and re-prompts the agent to continue if not.
 *
 * State is persisted to `attention/goal.json` in the working directory so it
 * survives across runs and container restarts.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, unlinkSync } from "fs";
import { join, dirname } from "path";
import { randomUUID } from "crypto";
import * as log from "../log.js";

export interface GoalState {
	id: string;
	description: string;
	setAt: string;
	status: "active" | "complete" | "abandoned";
	turnCount: number;
	maxTurns: number;
	completedAt?: string;
	completionSummary?: string;
	abandonReason?: string;
	turnHistory: TurnSummary[];
}

export interface TurnSummary {
	turn: number;
	at: string;
	summary: string;
	toolsUsed: string[];
}

export const GOAL_FILE = "attention/goal.json";
export const DEFAULT_MAX_TURNS = 20;

export function goalFilePath(workingDir: string): string {
	return join(workingDir, GOAL_FILE);
}

export function readGoalState(workingDir: string): GoalState | null {
	const path = goalFilePath(workingDir);
	if (!existsSync(path)) return null;
	try {
		const raw = readFileSync(path, "utf-8");
		const parsed = JSON.parse(raw) as GoalState;
		if (!parsed.id || !parsed.description) return null;
		return parsed;
	} catch (err) {
		log.logWarning(`[goal] Failed to read goal state: ${err instanceof Error ? err.message : String(err)}`);
		return null;
	}
}

export function isGoalActive(workingDir: string): boolean {
	const state = readGoalState(workingDir);
	return state !== null && state.status === "active";
}

function writeGoalState(workingDir: string, state: GoalState): void {
	const path = goalFilePath(workingDir);
	const dir = dirname(path);
	if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
	const tmpPath = `${path}.tmp`;
	writeFileSync(tmpPath, JSON.stringify(state, null, 2), "utf-8");
	renameSync(tmpPath, path);
}

export function setGoal(workingDir: string, description: string, maxTurns?: number): GoalState {
	const state: GoalState = {
		id: randomUUID(),
		description: description.trim(),
		setAt: new Date().toISOString(),
		status: "active",
		turnCount: 0,
		maxTurns: maxTurns ?? DEFAULT_MAX_TURNS,
		turnHistory: [],
	};
	writeGoalState(workingDir, state);
	log.logInfo(`[goal] Goal set: "${description.substring(0, 80)}" (max ${state.maxTurns} turns)`);
	return state;
}

export function recordGoalTurn(
	workingDir: string,
	summary: string,
	toolsUsed: string[],
): GoalState | null {
	const state = readGoalState(workingDir);
	if (!state || state.status !== "active") return null;

	state.turnCount += 1;
	state.turnHistory.push({
		turn: state.turnCount,
		at: new Date().toISOString(),
		summary: summary.substring(0, 500),
		toolsUsed,
	});

	if (state.turnHistory.length > 10) {
		state.turnHistory = state.turnHistory.slice(-10);
	}

	if (state.turnCount >= state.maxTurns) {
		state.status = "abandoned";
		state.abandonReason = `Reached max turns (${state.maxTurns})`;
		log.logInfo(`[goal] Auto-abandoned after ${state.turnCount} turns`);
	}

	writeGoalState(workingDir, state);
	return state;
}

export function completeGoal(workingDir: string, summary: string): GoalState | null {
	const state = readGoalState(workingDir);
	if (!state) return null;

	state.status = "complete";
	state.completedAt = new Date().toISOString();
	state.completionSummary = summary.substring(0, 1000);
	writeGoalState(workingDir, state);
	log.logInfo(`[goal] Goal completed after ${state.turnCount} turns: "${summary.substring(0, 80)}"`);
	return state;
}

export function abandonGoal(workingDir: string, reason: string): GoalState | null {
	const state = readGoalState(workingDir);
	if (!state) return null;

	state.status = "abandoned";
	state.abandonReason = reason;
	writeGoalState(workingDir, state);
	log.logInfo(`[goal] Goal abandoned: ${reason}`);
	return state;
}

export function clearGoal(workingDir: string): void {
	const path = goalFilePath(workingDir);
	if (existsSync(path)) {
		unlinkSync(path);
		log.logInfo(`[goal] Goal state cleared`);
	}
}

export function buildContinuationPrompt(state: GoalState): string {
	const recentTurns = state.turnHistory.slice(-3);
	const turnSummary = recentTurns.length > 0
		? recentTurns.map((t) => `  Turn ${t.turn}: ${t.summary}`).join("\n")
		: "  (no turns completed yet)";

	return [
		`[GOAL MODE — Turn ${state.turnCount + 1}/${state.maxTurns}]`,
		``,
		`Your goal: ${state.description}`,
		``,
		`Recent progress:`,
		turnSummary,
		``,
		`Continue working toward this goal. Use your tools to make progress. If you have completed the goal, call complete_goal with a summary of what you accomplished. If the goal is no longer achievable or relevant, call abandon_goal with a reason.`,
	].join("\n");
}
