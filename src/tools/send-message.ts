/**
 * send_message — explicit, validated messaging tool.
 *
 * Exactly one of `to` or `thread` must be present. `replyAll` is email-only and
 * requires `thread`. The tool result surfaces resolved recipients + subject +
 * thread ref + provider message id so the agent (and operators) can audit what
 * actually happened — no implicit channel-string smuggling.
 *
 * Routing:
 *   - `thread` → owning adapter resolves via PlatformAdapter.sendMessage
 *   - `to` (ChannelRef)  → adapterForChannelId(channel.id)
 *   - `to` (ContactRef[]) → all must share adapter
 */

import type { AgentTool } from "@mariozechner/pi-agent-core";
import { basename } from "path";
import { Type } from "typebox";
import * as log from "../log.js";
import type { AttachmentInput, SendMessageRequest } from "../messaging/send-message.js";
import { SendMessageValidationError, validateSendMessage } from "../messaging/send-message.js";
import type { AdapterName, ChannelRef, ContactRef, ThreadRef } from "../messaging/targets.js";
import {
	adapterForChannelId,
	adapterForContact,
	adapterForThread,
	decodeThreadRef,
} from "../messaging/targets.js";
import type { PlatformAdapter } from "../adapters/types.js";

interface RawSendMessageParams {
	label: string;
	to?: string | string[];
	thread?: string;
	replyAll?: boolean;
	subject?: string;
	text: string;
	attachments?: string[];
}

function parseTo(to: string | string[] | undefined): ChannelRef | ContactRef | ContactRef[] | undefined {
	if (to === undefined) return undefined;
	if (Array.isArray(to)) {
		if (to.length === 0) return undefined;
		return to.map((addr) => ({ kind: "contact" as const, adapter: "email" as const, address: addr.toLowerCase() }));
	}
	const trimmed = to.trim();
	if (trimmed.includes("@") && !trimmed.startsWith("email-")) {
		return { kind: "contact", adapter: "email", address: trimmed.toLowerCase() };
	}
	return { kind: "channel", id: trimmed };
}

function adapterForRequest(req: SendMessageRequest): AdapterName | undefined {
	if (req.thread) return adapterForThread(req.thread);
	if (req.to) {
		if (Array.isArray(req.to)) return adapterForContact(req.to[0]);
		if (req.to.kind === "contact") return adapterForContact(req.to);
		if (req.to.kind === "channel") return adapterForChannelId(req.to.id);
	}
	return undefined;
}

export function createSendMessageTool(adapters: PlatformAdapter[]): AgentTool<any> {
	const schema = Type.Object({
		label: Type.String({ description: "Brief description of what you're sending (shown in logs)" }),
		to: Type.Optional(
			Type.Union(
				[
					Type.String({ description: "Channel id (numeric Telegram chat, C/D/G Slack channel, email-{addr}, phone-{hash}) OR an email address for direct send" }),
					Type.Array(Type.String(), { description: "List of email addresses (email-only multi-recipient fresh send)" }),
				],
				{ description: "Target. Exactly one of `to` or `thread` must be provided." },
			),
		),
		thread: Type.Optional(
			Type.String({
				description: "Opaque ThreadRef to reply into. Get this from inbound message context (the `Thread:` header) or list_threads. Exactly one of `to` or `thread` must be provided.",
			}),
		),
		replyAll: Type.Optional(
			Type.Boolean({ description: "Email-only. Reply to all participants of the thread except yourself. Requires `thread`. Default false." }),
		),
		subject: Type.Optional(Type.String({ description: "Subject line (email only)." })),
		text: Type.String({ description: "Message body" }),
		attachments: Type.Optional(
			Type.Array(Type.String(), { description: "Absolute file paths to attach (email only)." }),
		),
	});

	return {
		name: "send_message",
		label: "send_message",
		description:
			"Send a message. Exactly one of `to` or `thread` is required. " +
			"Use `to` for fresh sends (channel id or email address). Use `thread` to reply into an existing conversation — the ThreadRef is published on every inbound message's `Thread:` header and discoverable via list_threads. " +
			"`replyAll` is email-only and requires `thread`; default is false (reply only to the original sender). " +
			"The tool result always shows the resolved recipients, subject, thread ref, and provider message id for auditability. " +
			"IMPORTANT: When a cross-channel message arrives while you are working, you MUST send a reply. Never leave a cross-channel message unacknowledged.",
		parameters: schema,
		execute: async (_toolCallId: string, params: unknown, signal?: AbortSignal) => {
			if (signal?.aborted) throw new Error("Operation aborted");

			const raw = params as RawSendMessageParams;

			let thread: ThreadRef | undefined;
			if (raw.thread) {
				thread = decodeThreadRef(raw.thread);
				if (!thread) {
					return {
						content: [{ type: "text" as const, text: `send_message: unable to decode thread ref "${raw.thread}"` }],
						details: undefined,
					};
				}
			}

			const to = parseTo(raw.to);
			const attachments: AttachmentInput[] | undefined = raw.attachments?.map((filePath) => ({
				filePath,
				filename: basename(filePath),
			}));

			let request: SendMessageRequest;
			try {
				request = validateSendMessage({
					to,
					thread,
					replyAll: raw.replyAll,
					subject: raw.subject,
					text: raw.text,
					attachments,
				});
			} catch (err) {
				const msg = err instanceof SendMessageValidationError ? err.message : String(err);
				return { content: [{ type: "text" as const, text: msg }], details: undefined };
			}

			const adapterName = adapterForRequest(request);
			if (!adapterName) {
				return {
					content: [{ type: "text" as const, text: "send_message: could not determine adapter from request" }],
					details: undefined,
				};
			}
			const adapter = adapters.find((a) => a.name === adapterName);
			if (!adapter) {
				return {
					content: [{ type: "text" as const, text: `send_message: no adapter "${adapterName}" available` }],
					details: undefined,
				};
			}

			try {
				if (!adapter.sendMessage) {
					return {
						content: [{ type: "text" as const, text: `send_message: adapter "${adapterName}" does not implement sendMessage yet` }],
						details: undefined,
					};
				}
				if (signal?.aborted) throw new Error("Operation aborted");
				const result = await adapter.sendMessage(request);
				log.logInfo(
					`[send_message] adapter=${result.adapter} recipients=${result.resolvedRecipients.join(",")} id=${result.providerMessageId}`,
				);
				const summary = [
					`Sent via ${result.adapter}`,
					`recipients: ${result.resolvedRecipients.join(", ")}`,
					result.resolvedSubject ? `subject: ${result.resolvedSubject}` : "",
					result.threadRef ? `thread: ${result.threadRef}` : "",
					`provider id: ${result.providerMessageId}`,
				]
					.filter(Boolean)
					.join("\n");
				return { content: [{ type: "text" as const, text: summary }], details: undefined };
			} catch (err) {
				const msg = err instanceof Error ? err.message : String(err);
				log.logWarning(`[send_message] failed adapter=${adapterName}`, msg);
				return { content: [{ type: "text" as const, text: `send_message failed: ${msg}` }], details: undefined };
			}
		},
	};
}
