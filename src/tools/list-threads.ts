/**
 * list_threads — enumerate recent threads with their ThreadRef.
 *
 * Reads <workingDir>/email-thread-events.jsonl and returns recent email threads.
 * Slack/Telegram/Phone threads aren't enumerable (no durable store yet) — the
 * agent recovers those refs by reading recent inbound `Thread:` headers in
 * context. v1 returns email only.
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { Type } from "typebox";
import { recentThreads } from "../adapters/email/thread-store.js";
import type { EmailThreadRef } from "../messaging/targets.js";
import { encodeThreadRef } from "../messaging/targets.js";

export interface ListThreadsToolConfig {
	workingDir: string;
}

function format(workingDir: string, limit: number): string {
	const threads = recentThreads(workingDir, limit);
	if (threads.length === 0) return "No threads yet.";
	const lines: string[] = [];
	lines.push("| ThreadRef | Subject | Participants | Updated |");
	lines.push("|-----------|---------|--------------|---------|");
	for (const t of threads) {
		const ref: EmailThreadRef = { kind: "thread", adapter: "email", id: t.threadKey };
		const encoded = encodeThreadRef(ref);
		const subject = (t.subject || "(no subject)").replace(/\|/g, "\\|");
		const participants = t.participants.slice(0, 3).join(", ") + (t.participants.length > 3 ? "…" : "");
		lines.push(`| \`${encoded}\` | ${subject} | ${participants} | ${t.updatedAt} |`);
	}
	return lines.join("\n");
}

export function createListThreadsTool(config: ListThreadsToolConfig): AgentTool<any> {
	const schema = Type.Object({
		limit: Type.Optional(Type.Number({ description: "Max threads to return. Default 20." })),
	});
	return {
		name: "list_threads",
		label: "list_threads",
		description:
			"List recent email threads with their ThreadRef. Use the returned ThreadRef as the `thread` argument to send_message to reply into a specific conversation, even after a container restart.",
		parameters: schema,
		execute: async (_toolCallId: string, params: unknown) => {
			const { limit } = params as { limit?: number };
			const text = format(config.workingDir, limit ?? 20);
			return { content: [{ type: "text" as const, text }], details: undefined };
		},
	};
}
