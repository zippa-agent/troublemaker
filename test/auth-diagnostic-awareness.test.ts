import { mkdtempSync, readFileSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import assert from "node:assert/strict";
import {
	appendRunDiagnostic,
	buildMissingModelAuthDiagnostic,
	isMissingModelAuthError,
	RUN_DIAGNOSTIC_CUSTOM_TYPE,
} from "../src/run-diagnostics.ts";
import { parseContextLine } from "../ui/src/types.ts";

const tempDir = mkdtempSync(join(tmpdir(), "auth-diagnostic-awareness-"));
const awarenessDir = join(tempDir, "awareness");

try {
	mkdirSync(awarenessDir, { recursive: true });

	assert.equal(isMissingModelAuthError("No API key found for openai-codex."), true);
	assert.equal(isMissingModelAuthError("network timeout"), false);

	const diagnostic = buildMissingModelAuthDiagnostic({
		provider: "openai-codex",
		modelId: "gpt-5.5",
		errorMessage: "No API key found for openai-codex.",
		channel: "slack:#social",
		source: "slack_message",
	});

	appendRunDiagnostic(awarenessDir, {
		...diagnostic,
		parentId: "parent123",
	});

	const line = readFileSync(join(awarenessDir, "context.jsonl"), "utf-8").trim();
	const raw = JSON.parse(line);

	assert.equal(raw.type, "custom");
	assert.equal(raw.customType, RUN_DIAGNOSTIC_CUSTOM_TYPE);
	assert.equal(raw.parentId, "parent123");
	assert.equal(raw.data.code, "model_auth_missing");
	assert.equal(raw.data.model, "openai-codex/gpt-5.5");
	assert.match(raw.data.action, /\/login openai-codex/);

	const parsed = parseContextLine(line);
	assert.equal(parsed?.isDiagnostic, true);
	assert.equal(parsed?.diagnosticLevel, "error");
	assert.equal(parsed?.diagnosticTitle, "Model authentication required");
	assert.equal(parsed?.diagnosticModel, "openai-codex/gpt-5.5");
	assert.equal(parsed?.channel, "slack:#social");
	assert.equal(parsed?.role, "assistant");
	assert.match(parsed?.strippedText || "", /does not have usable credentials/);

	console.log("auth diagnostic awareness test passed");
} finally {
	rmSync(tempDir, { recursive: true, force: true });
}
