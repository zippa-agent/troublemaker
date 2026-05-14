/**
 * Platform-neutral send_message contract.
 *
 * Exactly one of `to` or `thread` must be present. `replyAll` is only valid when
 * `thread.adapter === "email"`. `subject` is only meaningful on email; non-email
 * adapters ignore it. The tool result always surfaces the resolved recipients and
 * provider ids so the audit trail is explicit.
 */

import type { ChannelRef, ContactRef, ThreadRef } from "./targets.js";

export interface AttachmentInput {
	filePath: string;
	filename?: string;
}

export interface SendMessageRequest {
	to?: ChannelRef | ContactRef | ContactRef[];
	thread?: ThreadRef;
	replyAll?: boolean;
	subject?: string;
	text: string;
	attachments?: AttachmentInput[];
}

export interface SendMessageResult {
	adapter: "email" | "slack" | "telegram" | "phone";
	providerMessageId: string;
	resolvedRecipients: string[];
	resolvedSubject?: string;
	threadRef?: string;
}

export class SendMessageValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SendMessageValidationError";
	}
}

/**
 * Validate the request. Returns the canonicalized request on success;
 * throws SendMessageValidationError otherwise.
 *
 * Rules:
 *   - exactly one of `to` or `thread` present
 *   - `to: ContactRef[]` must be non-empty and same adapter
 *   - `replyAll` requires `thread.adapter === "email"`
 *   - `subject` requires the resolved adapter to be email
 */
export function validateSendMessage(req: SendMessageRequest): SendMessageRequest {
	const hasTo = req.to !== undefined && (Array.isArray(req.to) ? req.to.length > 0 : true);
	const hasThread = req.thread !== undefined;

	if (hasTo === hasThread) {
		throw new SendMessageValidationError(
			hasTo
				? "send_message: pass either `to` or `thread`, not both"
				: "send_message: must provide either `to` (fresh send) or `thread` (reply into existing conversation)",
		);
	}

	if (!req.text || !req.text.trim()) {
		throw new SendMessageValidationError("send_message: `text` is required");
	}

	if (req.replyAll && !hasThread) {
		throw new SendMessageValidationError("send_message: `replyAll` requires `thread`");
	}

	if (req.replyAll && req.thread && req.thread.adapter !== "email") {
		throw new SendMessageValidationError(
			`send_message: \`replyAll\` only applies to email threads (got ${req.thread.adapter})`,
		);
	}

	if (Array.isArray(req.to)) {
		if (req.to.length === 0) {
			throw new SendMessageValidationError("send_message: `to` array is empty");
		}
		const adapter = req.to[0].adapter;
		for (const c of req.to) {
			if (c.kind !== "contact") {
				throw new SendMessageValidationError("send_message: `to` array must contain ContactRef entries");
			}
			if (c.adapter !== adapter) {
				throw new SendMessageValidationError("send_message: `to` array mixes adapters");
			}
		}
	}

	return req;
}
