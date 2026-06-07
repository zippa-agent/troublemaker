import { composeEmailReplyBody, type EmailReplyQuote } from "./reply-composer.js";
import { normalizeMessageIdForHeader, parseReferencesHeader } from "./thread-headers.js";

export interface EmailThreadQuoteEvent {
	type?: "inbound" | "outbound";
	at?: string;
	channelId?: string;
	from?: string;
	to?: string[];
	subject?: string;
	body?: string;
	messageId?: string;
	providerMessageId?: string;
	inReplyTo?: string;
	references?: string;
}

export interface EmailThreadQuoteCurrent {
	channelId: string;
	from: string;
	fromFull?: string;
	agentAddress?: string;
	subject?: string;
	body: string;
	messageId?: string;
	inReplyTo?: string;
	references?: string;
	sentAt?: string;
}

export interface EmailThreadQuoteTurn {
	body: string;
	from: string;
	sentAt?: string;
}

const MAX_LEDGER_EVENTS = 2000;

export function parseEmailThreadLedger(text: string): EmailThreadQuoteEvent[] {
	const events: EmailThreadQuoteEvent[] = [];
	for (const line of text.split(/\r?\n/)) {
		if (!line.trim()) continue;
		try {
			const parsed = JSON.parse(line) as EmailThreadQuoteEvent;
			if ((parsed.type === "inbound" || parsed.type === "outbound") && typeof parsed.body === "string") {
				events.push(parsed);
			}
		} catch {
			// Ignore corrupt legacy rows; the ledger is append-only and best-effort.
		}
	}
	return events.slice(-MAX_LEDGER_EVENTS);
}

function normalizeSubject(subject: string | undefined): string {
	return (subject || "")
		.replace(/^\s*(?:re|fw|fwd):\s*/i, "")
		.replace(/\s+/g, " ")
		.trim()
		.toLowerCase();
}

function messageIdKey(value: string | undefined | null): string | undefined {
	const normalized = normalizeMessageIdForHeader(value);
	return normalized?.toLowerCase();
}

function collectReferenceKeys(raw: string | undefined | null): Set<string> {
	return new Set(parseReferencesHeader(raw).map((value) => value.toLowerCase()));
}

function eventReferenceKeys(event: EmailThreadQuoteEvent): Set<string> {
	const keys = collectReferenceKeys(event.references);
	const messageId = messageIdKey(event.messageId);
	const providerMessageId = messageIdKey(event.providerMessageId);
	const inReplyTo = messageIdKey(event.inReplyTo);
	if (messageId) keys.add(messageId);
	if (providerMessageId) keys.add(providerMessageId);
	if (inReplyTo) keys.add(inReplyTo);
	return keys;
}

function currentReferenceKeys(current: EmailThreadQuoteCurrent): Set<string> {
	const keys = collectReferenceKeys(current.references);
	const messageId = messageIdKey(current.messageId);
	const inReplyTo = messageIdKey(current.inReplyTo);
	if (messageId) keys.add(messageId);
	if (inReplyTo) keys.add(inReplyTo);
	return keys;
}

function intersects(left: Set<string>, right: Set<string>): boolean {
	for (const value of left) {
		if (right.has(value)) return true;
	}
	return false;
}

function eventSortKey(event: EmailThreadQuoteEvent, index: number): number {
	const date = event.at ? Date.parse(event.at) : Number.NaN;
	return Number.isFinite(date) ? date : index;
}

function selectThreadEvents(
	events: EmailThreadQuoteEvent[],
	current: EmailThreadQuoteCurrent,
): EmailThreadQuoteEvent[] {
	const subject = normalizeSubject(current.subject);
	const refs = currentReferenceKeys(current);
	const candidates = events
		.map((event, index) => ({ event, index }))
		.filter(({ event }) => event.channelId === current.channelId && typeof event.body === "string" && event.body.trim())
		.filter(({ event }) => {
			const eventSubject = normalizeSubject(event.subject);
			if (subject && eventSubject && eventSubject !== subject) return false;
			if (refs.size === 0) return subject ? eventSubject === subject : true;
			const eventRefs = eventReferenceKeys(event);
			if (eventRefs.size === 0) return subject && eventSubject === subject;
			return intersects(refs, eventRefs);
		});

	return candidates
		.sort((a, b) => eventSortKey(a.event, a.index) - eventSortKey(b.event, b.index))
		.map(({ event }) => event);
}

function eventTurn(event: EmailThreadQuoteEvent, current: EmailThreadQuoteCurrent): EmailThreadQuoteTurn | undefined {
	const body = event.body?.trim();
	if (!body) return undefined;
	const from = event.type === "outbound"
		? (event.from || current.agentAddress || "Zip")
		: (event.from || current.fromFull || current.from);
	return { body, from, sentAt: event.at };
}

function sameMessage(left: EmailThreadQuoteEvent, current: EmailThreadQuoteCurrent): boolean {
	const currentMessageId = messageIdKey(current.messageId);
	if (currentMessageId) {
		const eventIds = eventReferenceKeys(left);
		if (eventIds.has(currentMessageId)) return true;
	}
	return false;
}

export function buildEmailConversationQuoteBody(turns: EmailThreadQuoteTurn[]): string | undefined {
	const usable = turns.filter((turn) => turn.body.trim());
	if (usable.length === 0) return undefined;
	let threadBody = usable[0].body.trim();
	for (let i = 1; i < usable.length; i++) {
		const previousTurn = usable[i - 1];
		threadBody = composeEmailReplyBody(usable[i].body, {
			body: threadBody,
			from: previousTurn.from,
			sentAt: previousTurn.sentAt,
		});
	}
	return threadBody;
}

export function buildEmailReplyQuoteFromThreadEvents(
	events: EmailThreadQuoteEvent[],
	current: EmailThreadQuoteCurrent,
): EmailReplyQuote | undefined {
	if (!current.body.trim()) return undefined;
	const priorTurns = selectThreadEvents(events, current)
		.filter((event) => !sameMessage(event, current))
		.map((event) => eventTurn(event, current))
		.filter((turn): turn is EmailThreadQuoteTurn => Boolean(turn));
	const currentTurn: EmailThreadQuoteTurn = {
		body: current.body,
		from: current.fromFull || current.from,
		sentAt: current.sentAt,
	};
	const body = buildEmailConversationQuoteBody([...priorTurns, currentTurn]) || current.body;
	return {
		body,
		from: current.fromFull || current.from,
		sentAt: current.sentAt,
	};
}
