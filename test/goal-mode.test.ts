/**
 * Tests for goal mode state management.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
	setGoal,
	readGoalState,
	isGoalActive,
	recordGoalTurn,
	completeGoal,
	abandonGoal,
	clearGoal,
	buildContinuationPrompt,
	DEFAULT_MAX_TURNS,
	GOAL_FILE,
} from "../src/goal/goal-state.js";

let tempDir: string;

beforeEach(() => {
	tempDir = mkdtempSync(join(tmpdir(), "goal-test-"));
});

afterEach(() => {
	rmSync(tempDir, { recursive: true, force: true });
});

describe("goal-state", () => {
	it("setGoal creates an active goal", () => {
		const state = setGoal(tempDir, "Write a hello world script");
		assert.equal(state.status, "active");
		assert.equal(state.description, "Write a hello world script");
		assert.equal(state.turnCount, 0);
		assert.equal(state.maxTurns, DEFAULT_MAX_TURNS);
		assert.ok(state.id);
		assert.ok(state.setAt);
	});

	it("setGoal respects custom maxTurns", () => {
		const state = setGoal(tempDir, "Do something", 5);
		assert.equal(state.maxTurns, 5);
	});

	it("readGoalState returns null when no goal exists", () => {
		assert.equal(readGoalState(tempDir), null);
	});

	it("readGoalState returns the active goal", () => {
		setGoal(tempDir, "Write tests");
		const state = readGoalState(tempDir);
		assert.ok(state);
		assert.equal(state!.description, "Write tests");
		assert.equal(state!.status, "active");
	});

	it("isGoalActive returns true after setGoal", () => {
		setGoal(tempDir, "Active goal");
		assert.equal(isGoalActive(tempDir), true);
	});

	it("isGoalActive returns false when no goal exists", () => {
		assert.equal(isGoalActive(tempDir), false);
	});

	it("isGoalActive returns false after completeGoal", () => {
		setGoal(tempDir, "Complete me");
		completeGoal(tempDir, "Done!");
		assert.equal(isGoalActive(tempDir), false);
	});

	it("isGoalActive returns false after abandonGoal", () => {
		setGoal(tempDir, "Abandon me");
		abandonGoal(tempDir, "Not achievable");
		assert.equal(isGoalActive(tempDir), false);
	});

	it("recordGoalTurn increments turn count and records history", () => {
		setGoal(tempDir, "Multi-turn goal");
		const state1 = recordGoalTurn(tempDir, "Did step 1", ["bash", "write"]);
		assert.ok(state1);
		assert.equal(state1!.turnCount, 1);
		assert.equal(state1!.turnHistory.length, 1);
		assert.equal(state1!.turnHistory[0].summary, "Did step 1");
		assert.deepEqual(state1!.turnHistory[0].toolsUsed, ["bash", "write"]);
	});

	it("recordGoalTurn auto-abandons at maxTurns", () => {
		setGoal(tempDir, "Limited goal", 2);
		recordGoalTurn(tempDir, "Turn 1", []);
		const state = recordGoalTurn(tempDir, "Turn 2", []);
		assert.ok(state);
		assert.equal(state!.status, "abandoned");
		assert.ok(state!.abandonReason?.includes("max turns"));
	});

	it("completeGoal sets status to complete with summary", () => {
		setGoal(tempDir, "Finish it");
		recordGoalTurn(tempDir, "Working...", []);
		const state = completeGoal(tempDir, "All done, tests pass");
		assert.ok(state);
		assert.equal(state!.status, "complete");
		assert.equal(state!.completionSummary, "All done, tests pass");
		assert.ok(state!.completedAt);
	});

	it("abandonGoal sets status to abandoned with reason", () => {
		setGoal(tempDir, "Try it");
		const state = abandonGoal(tempDir, "Dependencies missing");
		assert.ok(state);
		assert.equal(state!.status, "abandoned");
		assert.equal(state!.abandonReason, "Dependencies missing");
	});

	it("clearGoal removes the goal file", () => {
		setGoal(tempDir, "Temporary goal");
		assert.ok(existsSync(join(tempDir, GOAL_FILE)));
		clearGoal(tempDir);
		assert.equal(existsSync(join(tempDir, GOAL_FILE)), false);
		assert.equal(readGoalState(tempDir), null);
	});

	it("buildContinuationPrompt includes goal description and turn info", () => {
		setGoal(tempDir, "Build a feature", 10);
		recordGoalTurn(tempDir, "Created the file", ["write"]);
		const state = readGoalState(tempDir)!;
		const prompt = buildContinuationPrompt(state);
		assert.ok(prompt.includes("Build a feature"));
		assert.ok(prompt.includes("Turn 2/10"));
		assert.ok(prompt.includes("Created the file"));
		assert.ok(prompt.includes("complete_goal"));
	});

	it("setGoal overwrites previous goal", () => {
		setGoal(tempDir, "First goal");
		setGoal(tempDir, "Second goal");
		const state = readGoalState(tempDir);
		assert.ok(state);
		assert.equal(state!.description, "Second goal");
		assert.equal(state!.turnCount, 0);
	});

	it("goal state persists to disk", () => {
		setGoal(tempDir, "Persistent goal");
		const raw = readFileSync(join(tempDir, GOAL_FILE), "utf-8");
		const parsed = JSON.parse(raw);
		assert.equal(parsed.description, "Persistent goal");
		assert.equal(parsed.status, "active");
	});
});
