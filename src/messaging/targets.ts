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
	/** Stable conversation key. */
	id: string;
	/** Exact inbound Message-ID this reply should parent to, when known. */
	parentMessageId?: string;
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
//
// Email refs use the raw RFC 5322 Message-ID as-is. No base64, no JSON, no
// other wrapping. Email's own threading convention (Message-ID / In-Reply-To /
// References) already gives every conversation a stable string identifier;
// there's no need to invent a different shape on top of it. Slack and Telegram
// use compact native ids joined with `:`; phone aliases its channel id.
// ---------------------------------------------------------------------------

export function encodeThreadRef(ref: ThreadRef): string {
	switch (ref.adapter) {
		case "email": {
			const parent = ref.parentMessageId ? `:parent:${encodeURIComponent(ref.parentMessageId)}` : "";
			return `email:thread:${ref.id}${parent}`;
		}
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
		const rest = encoded.slice("email:thread:".length).trim();
		if (!rest) return undefined;
		const marker = rest.lastIndexOf(":parent:");
		if (marker !== -1) {
			const id = rest.slice(0, marker);
			const parentMessageId = decodeURIComponent(rest.slice(marker + ":parent:".length));
			if (!id) return undefined;
			return { kind: "thread", adapter: "email", id, parentMessageId };
		}
		return { kind: "thread", adapter: "email", id: rest };
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
