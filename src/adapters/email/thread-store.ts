/**
 * Durable email thread event store.
 *
 * Append-only JSONL log of inbound and outbound email events under
 * <workingDir>/email-thread-events.jsonl. The thread record is the *fold* of the
 * event stream: lookups read the file and reconstruct the thread state on demand.
 * No derived index file in v1 — read-perf optimization deferred until we see a
 * real workload.
 *
 * Every event references a stable thread key (see thread-normalize.buildThreadKey)
 * which the agent sees as an opaque EmailThreadRef.id. Email ThreadRefs may
 * also carry the exact parent inbound Message-ID to reply to.
 */

import { appendFileSync, existsSync, readFileSync } from "fs";
import { join } from "path";
import {
	buildThreadKey,
	canonicalMessageId,
	formatReferences,
	mergeReferences,
	normalizeParticipants,
	normalizeSubject,
	parseReferences,
} from "./thread-normalize.js";

export interface InboundEmailInput {
	from: string;
	to?: string;
	subject?: string;
	body?: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string;
	allRecipients?: string[];
	emailChannel?: string | null;
	channelId: string;
	receivedAt?: string;
}

export interface OutboundEmailInput {
	threadKey: string;
	to: string[];
	cc?: string[];
	subject?: string;
	body?: string;
	providerMessageId?: string;
	rfcMessageId?: string;
	inReplyTo?: string;
	references?: string[];
	/** Verbatim References header we emitted on the outbound. */
	rawReferences?: string;
	channelId: string;
	sentAt?: string;
}

export interface EmailEventRecord {
	type: "inbound" | "outbound";
	threadKey: string;
	channelId: string;
	from?: string;
	to: string[];
	cc: string[];
	selfEmail?: string;
	subject: string;
	normalizedSubject: string;
	/** Raw message body, decorations-free. Used to reconstruct quote chains. */
	body?: string;
	messageId?: string;
	rfcMessageId?: string;
	providerMessageId?: string;
	inReplyTo?: string;
	/**
	 * Canonical references chain (no brackets, deduped, ordered oldest-first).
	 * Used for thread keying and summary fold. NOT the value to emit on outbound
	 * — that's `rawReferences`, which preserves the parent's exact header.
	 */
	references: string[];
	/**
	 * Verbatim References header value from the parent message (inbound) or the
	 * value we emitted (outbound). On reply, RFC 5322 §3.6.4 says the next
	 * message's References = parent's rawReferences + parent's Message-ID
	 * appended. Storing this verbatim avoids reconstructing the chain from a
	 * lossy summary union.
	 */
	rawReferences?: string;
	emailChannel?: string | null;
	at: string;
}

export interface EmailThreadSummary {
	threadKey: string;
	channelId: string;
	subject: string;
	normalizedSubject: string;
	participants: string[];
	selfEmail?: string;
	lastInboundMessageId?: string;
	lastOutboundMessageId?: string;
	references: string[];
	emailChannel?: string | null;
	updatedAt: string;
}

const FILE = "email-thread-events.jsonl";

function eventsPath(workingDir: string): string {
	return join(workingDir, FILE);
}

function readAll(workingDir: string): EmailEventRecord[] {
	const path = eventsPath(workingDir);
	if (!existsSync(path)) return [];
	let raw: string;
	try {
		raw = readFileSync(path, "utf-8");
	} catch {
		return [];
	}
	const out: EmailEventRecord[] = [];
	for (const line of raw.split("\n")) {
		if (!line.trim()) continue;
		try {
			out.push(JSON.parse(line) as EmailEventRecord);
		} catch {
			// Skip malformed lines silently — durability beats strictness.
		}
	}
	return out;
}

function append(workingDir: string, record: EmailEventRecord): void {
	appendFileSync(eventsPath(workingDir), `${JSON.stringify(record)}\n`);
}

export function appendInbound(workingDir: string, input: InboundEmailInput): EmailEventRecord {
	const messageId = canonicalMessageId(input.messageId);
	const inReplyTo = canonicalMessageId(input.inReplyTo);
	const references = parseReferences(input.references);
	const subject = input.subject || "";
	const normalizedSubject = normalizeSubject(subject);

	const allParticipants = normalizeParticipants([input.from, input.to, ...(input.allRecipients ?? [])]);

	const threadKey = buildThreadKey({
		references,
		inReplyTo,
		messageId,
		subject,
		participants: allParticipants,
	});

	const record: EmailEventRecord = {
		type: "inbound",
		threadKey,
		channelId: input.channelId,
		from: input.from,
		to: input.to ? [input.to] : [],
		cc: input.allRecipients ?? [],
		selfEmail: input.to ? input.to.toLowerCase() : undefined,
		subject,
		normalizedSubject,
		body: input.body,
		messageId,
		rfcMessageId: messageId || undefined,
		inReplyTo: inReplyTo || undefined,
		references: mergeReferences(references, [inReplyTo, messageId]),
		rawReferences: formatReferences(references) || undefined,
		emailChannel: input.emailChannel ?? null,
		at: input.receivedAt || new Date().toISOString(),
	};

	append(workingDir, record);
	return record;
}

export function appendOutbound(workingDir: string, input: OutboundEmailInput): EmailEventRecord {
	const rfcMessageId = canonicalMessageId(input.rfcMessageId);
	const inReplyTo = canonicalMessageId(input.inReplyTo);
	const refs = mergeReferences(input.references ?? [], [inReplyTo, rfcMessageId]);
	const subject = input.subject || "";
	const record: EmailEventRecord = {
		type: "outbound",
		threadKey: input.threadKey,
		channelId: input.channelId,
		to: input.to,
		cc: input.cc ?? [],
		subject,
		normalizedSubject: normalizeSubject(subject),
		body: input.body,
		messageId: rfcMessageId || undefined,
		rfcMessageId: rfcMessageId || undefined,
		providerMessageId: input.providerMessageId,
		inReplyTo: inReplyTo || undefined,
		references: refs,
		rawReferences: input.rawReferences || formatReferences(input.references ?? []) || undefined,
		at: input.sentAt || new Date().toISOString(),
	};
	append(workingDir, record);
	return record;
}

export function findByMessageId(workingDir: string, messageId: string): EmailEventRecord | undefined {
	const canonical = canonicalMessageId(messageId);
	if (!canonical) return undefined;
	const events = readAll(workingDir);
	for (let i = events.length - 1; i >= 0; i--) {
		if (events[i].messageId === canonical || events[i].rfcMessageId === canonical) {
			return events[i];
		}
	}
	return undefined;
}

export function findByThreadKey(workingDir: string, threadKey: string): EmailEventRecord[] {
	return readAll(workingDir).filter((e) => e.threadKey === threadKey);
}

/**
 * Resolve a ThreadRef.id into a thread summary by folding all matching events.
 * Returns undefined if no events match.
 */
export function summarizeThread(workingDir: string, threadKey: string): EmailThreadSummary | undefined {
	const events = findByThreadKey(workingDir, threadKey);
	if (events.length === 0) return undefined;

	const participants = new Set<string>();
	let subject = "";
	let normalizedSubject = "";
	let channelId = "";
	let selfEmail: string | undefined;
	let emailChannel: string | null | undefined;
	let lastInboundMessageId: string | undefined;
	let lastOutboundMessageId: string | undefined;
	let references: string[] = [];
	let updatedAt = "";

	for (const e of events) {
		if (e.from) participants.add(e.from.toLowerCase());
		for (const t of e.to) participants.add(t.toLowerCase());
		for (const c of e.cc) participants.add(c.toLowerCase());
		if (e.subject && !subject) subject = e.subject;
		if (e.normalizedSubject && !normalizedSubject) normalizedSubject = e.normalizedSubject;
		if (e.channelId) channelId = e.channelId;
		if (e.selfEmail) selfEmail = e.selfEmail;
		if (e.emailChannel !== undefined) emailChannel = e.emailChannel;
		if (e.type === "inbound" && e.messageId) lastInboundMessageId = e.messageId;
		if (e.type === "outbound" && e.messageId) lastOutboundMessageId = e.messageId;
		references = mergeReferences(references, e.references);
		if (!updatedAt || e.at > updatedAt) updatedAt = e.at;
	}

	// Reply-all participant list: drop self.
	const all = Array.from(participants).filter((p) => !!p);
	const sansSelf = selfEmail ? all.filter((p) => p !== selfEmail) : all;

	return {
		threadKey,
		channelId,
		subject,
		normalizedSubject,
		participants: sansSelf,
		selfEmail,
		lastInboundMessageId,
		lastOutboundMessageId,
		references,
		emailChannel,
		updatedAt,
	};
}

export function recentThreads(workingDir: string, limit: number): EmailThreadSummary[] {
	const events = readAll(workingDir);
	if (events.length === 0) return [];
	const byKey = new Map<string, EmailEventRecord[]>();
	for (const e of events) {
		const arr = byKey.get(e.threadKey) ?? [];
		arr.push(e);
		byKey.set(e.threadKey, arr);
	}
	const summaries: EmailThreadSummary[] = [];
	for (const key of byKey.keys()) {
		const s = summarizeThread(workingDir, key);
		if (s) summaries.push(s);
	}
	summaries.sort((a, b) => (a.updatedAt > b.updatedAt ? -1 : a.updatedAt < b.updatedAt ? 1 : 0));
	return summaries.slice(0, limit);
}
