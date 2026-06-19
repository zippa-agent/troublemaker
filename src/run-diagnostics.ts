import { randomUUID } from "crypto";
import { appendFileSync } from "fs";
import { join } from "path";
import * as log from "./log.js";

export const RUN_DIAGNOSTIC_CUSTOM_TYPE = "run_diagnostic";

export type RunDiagnosticLevel = "info" | "warning" | "error";

export interface RunDiagnosticData {
	level: RunDiagnosticLevel;
	code: string;
	title: string;
	message: string;
	detail?: string;
	action?: string;
	model?: string;
	provider?: string;
	channel?: string;
	source?: string;
}

export interface AppendRunDiagnosticOptions extends RunDiagnosticData {
	parentId?: string | null;
}

export function isMissingModelAuthError(message: string): boolean {
	const normalized = message.replace(/\s+/g, " ").trim().toLowerCase();
	if (!normalized) return false;
	return (
		normalized.includes("no api key found") ||
		normalized.includes("missing api key") ||
		normalized.includes("api key is required") ||
		normalized.includes("authentication required")
	);
}

export function buildMissingModelAuthDiagnostic(options: {
	provider?: string;
	modelId?: string;
	errorMessage: string;
	channel?: string;
	source?: string;
}): RunDiagnosticData {
	const provider = options.provider || "selected provider";
	const model = options.modelId ? `${provider}/${options.modelId}` : provider;
	const loginAction =
		provider === "openai-codex"
			? "Run /login openai-codex in the web app, then retry the message. If login just succeeded, credential persistence or hydration did not restore the Codex auth file after restart."
			: `Authenticate ${provider} in the web app or switch this agent to a model with working credentials.`;

	return {
		level: "error",
		code: "model_auth_missing",
		title: "Model authentication required",
		message: `${model} is selected, but this runtime does not have usable credentials for ${provider}.`,
		detail: options.errorMessage,
		action: loginAction,
		model,
		provider,
		channel: options.channel,
		source: options.source,
	};
}

export function appendRunDiagnostic(awarenessDir: string, diagnostic: AppendRunDiagnosticOptions): void {
	const contextFile = join(awarenessDir, "context.jsonl");
	try {
		const timestamp = new Date().toISOString();
		const { parentId, ...data } = diagnostic;
		const entry = {
			type: "custom",
			customType: RUN_DIAGNOSTIC_CUSTOM_TYPE,
			id: randomUUID().substring(0, 8),
			parentId: parentId ?? null,
			timestamp,
			data: {
				...data,
				timestamp,
			},
		};
		appendFileSync(contextFile, `${JSON.stringify(entry)}\n`);
	} catch (err) {
		log.logWarning("Failed to append run diagnostic", err instanceof Error ? err.message : String(err));
	}
}
