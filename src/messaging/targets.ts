/**
 * Routing primitives for send_message.
 *
 * Three kinds of target:
 *   - ChannelRef: a platform channel id (Slack channel, Telegram chat, phone hash, email-{addr}).
 *   - ContactRef: a contact handle, today only email addresses; one or many.
 *   - ThreadRef:  a stable opaque routing key for replying into a known conversation.
 *
 * ThreadRef carries the adapter so the router can find the owning adapter without
 * parsing the rest of the ref. The interior shape is documented per adapter but the
 * agent treats the encoded string form as opaque — round-trip only.
 *
 * Encoded string forms:
 *   email:thread:<base64url(messageId or normalized-subject-hash)>
 *   slack:thread:<channel>:<thread_ts>
 *   telegram:msg:<chat>:<message_id>
 *   phone:<channel-id>
 */

export type AdapterName = "email" | "slack" | "telegram" | "phone";

export interface ChannelRef {
	kind: "channel";
	id: string;
}

export interface ContactRef {
	kind: "contact";
	adapter: "email";
	address: string;
}

export type EmailThreadRef = {
	kind: "thread";
	adapter: "email";
	id: string;
};
export type SlackThreadRef = {
	kind: "thread";
	adapter: "slack";
	channel: string;
	threadTs: string;
};
export type TelegramThreadRef = {
	kind: "thread";
	adapter: "telegram";
	chat: string;
	replyToMessageId: string;
};
export type PhoneThreadRef = {
	kind: "thread";
	adapter: "phone";
	channel: string;
};

export type ThreadRef = EmailThreadRef | SlackThreadRef | TelegramThreadRef | PhoneThreadRef;

export type AnyRef = ChannelRef | ContactRef | ThreadRef;

// ---------------------------------------------------------------------------
// Encoding ↔ decoding
// ---------------------------------------------------------------------------

function b64urlEncode(s: string): string {
	return Buffer.from(s, "utf-8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): string {
	const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
	return Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64").toString("utf-8");
}

export function encodeThreadRef(ref: ThreadRef): string {
	switch (ref.adapter) {
		case "email":
			return `email:thread:${b64urlEncode(ref.id)}`;
		case "slack":
			return `slack:thread:${ref.channel}:${ref.threadTs}`;
		case "telegram":
			return `telegram:msg:${ref.chat}:${ref.replyToMessageId}`;
		case "phone":
			return `phone:${ref.channel}`;
	}
}

export function decodeThreadRef(encoded: string): ThreadRef | undefined {
	if (encoded.startsWith("email:thread:")) {
		const id = b64urlDecode(encoded.slice("email:thread:".length));
		if (!id) return undefined;
		return { kind: "thread", adapter: "email", id };
	}
	if (encoded.startsWith("slack:thread:")) {
		const rest = encoded.slice("slack:thread:".length);
		const colon = rest.indexOf(":");
		if (colon === -1) return undefined;
		const channel = rest.slice(0, colon);
		const threadTs = rest.slice(colon + 1);
		if (!channel || !threadTs) return undefined;
		return { kind: "thread", adapter: "slack", channel, threadTs };
	}
	if (encoded.startsWith("telegram:msg:")) {
		const rest = encoded.slice("telegram:msg:".length);
		const colon = rest.indexOf(":");
		if (colon === -1) return undefined;
		const chat = rest.slice(0, colon);
		const replyToMessageId = rest.slice(colon + 1);
		if (!chat || !replyToMessageId) return undefined;
		return { kind: "thread", adapter: "telegram", chat, replyToMessageId };
	}
	if (encoded.startsWith("phone:")) {
		const channel = encoded.slice("phone:".length);
		if (!channel) return undefined;
		return { kind: "thread", adapter: "phone", channel };
	}
	return undefined;
}

// ---------------------------------------------------------------------------
// Adapter inference (no thread ref required)
// ---------------------------------------------------------------------------

/** Infer adapter name from a ChannelRef id using the same patterns as resolveAdapter. */
export function adapterForChannelId(channelId: string): AdapterName | undefined {
	if (/^-?\d+$/.test(channelId)) return "telegram";
	if (/^[CDG]/.test(channelId)) return "slack";
	if (channelId.startsWith("email-")) return "email";
	if (channelId.startsWith("phone-")) return "phone";
	return undefined;
}

export function adapterForContact(ref: ContactRef): AdapterName {
	return ref.adapter;
}

export function adapterForThread(ref: ThreadRef): AdapterName {
	return ref.adapter;
}
