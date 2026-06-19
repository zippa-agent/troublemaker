import { appendFileSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { createHash } from "crypto";
import { join } from "path";
import * as log from "../log.js";
import type { ChannelStore } from "../store.js";
import type { ChannelInfo, MomContext, MomEvent, MomHandler, PlatformAdapter, UserInfo } from "./types.js";

const MAX_FORM_WEBHOOK_BODY_BYTES = 256 * 1024;

type FieldValue = string | string[];

export interface FormInboundPayload {
	source: "website_form";
	submissionId: string;
	submittedAt: string;
	site: {
		id: string;
		slug: string;
		displayName: string;
		previewUrl: string;
		productionUrl?: string | null;
		hostname: string;
	};
	form?: {
		id?: string;
		pageUrl?: string;
	};
	visitor?: {
		name?: string;
		email?: string;
		phone?: string;
	};
	fields: Record<string, FieldValue>;
	fieldOrder?: string[];
	text?: string;
	metadata?: Record<string, unknown>;
}

interface FormChannelRecord {
	channelId: string;
	siteId: string;
	siteSlug: string;
	displayName: string;
	visitorIdentity: string;
	lastSubmissionId: string;
	updatedAt: string;
}

export interface FormWebhookAdapterConfig {
	workingDir: string;
}

export class FormWebhookAdapter implements PlatformAdapter {
	readonly name = "form";
	readonly maxMessageLength = 100000;
	readonly formatInstructions = `## Website Form Ingress
You are handling a website contact-form submission. Treat it as a lead or customer inquiry for the site's owner. There is no direct website-form reply transport in this channel yet, so do not assume your final answer is sent to the visitor and do not send_message to a form-* channel. Use available tools such as send_message to notify the owner or another configured channel only when you know a real outbound target.`;

	private workingDir: string;
	private handler!: MomHandler;
	private channels = new Map<string, FormChannelRecord>();
	private users = new Map<string, UserInfo>();
	private processedSubmissions = new Set<string>();

	constructor(config: FormWebhookAdapterConfig) {
		this.workingDir = config.workingDir;
	}

	setHandler(handler: MomHandler): void {
		this.handler = handler;
	}

	async start(): Promise<void> {
		if (!this.handler) throw new Error("FormWebhookAdapter: handler not set. Call setHandler() before start().");
		log.logInfo("[form] adapter ready");
		log.logConnected();
	}

	async stop(): Promise<void> {
		// Gateway owns the HTTP server.
	}

	dispatch(req: IncomingMessage, res: ServerResponse): void {
		const chunks: Buffer[] = [];
		let bodyBytes = 0;
		let rejected = false;
		req.on("data", (chunk: Buffer) => {
			if (rejected) return;
			bodyBytes += chunk.length;
			if (bodyBytes > MAX_FORM_WEBHOOK_BODY_BYTES) {
				rejected = true;
				res.writeHead(413);
				res.end("Payload too large");
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", async () => {
			if (rejected) return;
			const body = Buffer.concat(chunks).toString("utf-8");
			let payload: FormInboundPayload;
			try {
				payload = JSON.parse(body) as FormInboundPayload;
			} catch {
				res.writeHead(400);
				res.end("Invalid JSON");
				return;
			}

			const missing = validatePayload(payload);
			if (missing) {
				res.writeHead(400);
				res.end(`Invalid or missing field: ${missing}`);
				return;
			}

			res.writeHead(200, { "Content-Type": "application/json" });
			res.end(JSON.stringify({ ok: true }));

			try {
				await this.processInbound(payload);
			} catch (err) {
				log.logWarning("[form] inbound processing error", err instanceof Error ? err.message : String(err));
			}
		});
	}

	private async processInbound(payload: FormInboundPayload): Promise<void> {
		const submissionKey = `${payload.site.id}:${payload.submissionId}`;
		if (this.processedSubmissions.has(submissionKey)) {
			log.logInfo(`[form] duplicate submission ignored site=${payload.site.slug} submission=${payload.submissionId}`);
			return;
		}
		this.processedSubmissions.add(submissionKey);

		const record = this.upsertChannel(payload);
		const ts = payload.submittedAt || new Date().toISOString();
		const userId = visitorIdentity(payload);
		const displayName = payload.visitor?.name || payload.visitor?.email || payload.visitor?.phone || "Website visitor";
		this.users.set(userId, { id: userId, userName: displayName, displayName });

		const text = payload.text?.trim() || buildSubmissionText(payload);
		const event: MomEvent = {
			type: "dm",
			channel: record.channelId,
			ts,
			user: userId,
			text,
			rawText: text,
			sourceEventType: "form_submission",
			directlyAddressed: true,
		};

		this.logToFile({
			date: toIsoDate(ts),
			ts,
			channel: `form:${record.displayName}`,
			channelId: record.channelId,
			user: userId,
			userName: displayName,
			displayName,
			text,
			attachments: [],
			isBot: false,
			sourceEventType: "form_submission",
			submissionId: payload.submissionId,
			site: payload.site,
			form: payload.form,
			visitor: payload.visitor || {},
			metadata: payload.metadata || {},
		});

		if (this.handler.resolvePendingInput(record.channelId, text)) return;

		if (this.handler.isRunning(record.channelId)) {
			this.handler.handleSteer(event, this);
		} else {
			await this.handler.handleEvent(event, this);
		}
	}

	async postMessage(channel: string, text: string): Promise<string> {
		const ts = new Date().toISOString();
		this.logBotResponse(channel, text, ts);
		return ts;
	}

	async updateMessage(_channel: string, _ts: string, _text: string): Promise<void> {
		// Website form submissions do not have editable outbound messages.
	}

	async deleteMessage(_channel: string, _ts: string): Promise<void> {
		// Website form submissions do not have deletable outbound messages.
	}

	async postInThread(channel: string, _threadTs: string, text: string): Promise<string> {
		return this.postMessage(channel, text);
	}

	async uploadFile(_channel: string, _filePath: string, _title?: string): Promise<void> {
		throw new Error("Website form ingress cannot upload files yet. Use another channel for outbound files.");
	}

	logToFile(entry: object): void {
		appendFileSync(join(this.workingDir, "log.jsonl"), `${JSON.stringify(entry)}\n`);
	}

	logBotResponse(channel: string, text: string, ts: string): void {
		const record = this.resolveChannel(channel);
		this.logToFile({
			date: new Date().toISOString(),
			ts,
			channel: `form:${record.displayName}`,
			channelId: record.channelId,
			user: "bot",
			text,
			attachments: [],
			isBot: true,
			sourceEventType: "form_response",
			siteSlug: record.siteSlug,
			lastSubmissionId: record.lastSubmissionId,
		});
	}

	getUser(userId: string): UserInfo | undefined {
		return this.users.get(userId);
	}

	getChannel(channelId: string): ChannelInfo | undefined {
		const record = this.channels.get(channelId);
		return record ? { id: record.channelId, name: record.displayName } : undefined;
	}

	getAllUsers(): UserInfo[] {
		return Array.from(this.users.values());
	}

	getAllChannels(): ChannelInfo[] {
		return Array.from(this.channels.values()).map((channel) => ({ id: channel.channelId, name: channel.displayName }));
	}

	enqueueEvent(event: MomEvent): boolean {
		if (!event.channel.startsWith("form-")) return false;
		this.handler.handleEvent(event, this, true).catch((err) => {
			log.logWarning(`[form] event handler error for ${event.channel}`, err instanceof Error ? err.message : String(err));
		});
		return true;
	}

	createContext(event: MomEvent, _store: ChannelStore, _isEvent?: boolean): MomContext {
		let finalText = "";
		let forceFinalResponse = false;
		return {
			message: {
				text: event.text,
				rawText: event.rawText ?? event.text,
				user: event.user,
				userName: this.users.get(event.user)?.displayName || event.user,
				channel: event.channel,
				ts: event.ts,
				eventType: event.type,
				sourceEventType: event.sourceEventType,
				directlyAddressed: event.directlyAddressed,
				threadTs: event.threadTs,
				replyTarget: event.replyTarget,
				replyTargetDescription: event.replyTargetDescription,
				attachments: [],
			},
			channelName: this.channels.get(event.channel)?.displayName,
			channels: this.getAllChannels(),
			users: this.getAllUsers(),
			respond: async () => {
				// No direct form response transport in this slice.
			},
			sendFinalResponse: async (text: string, options = {}) => {
				const force = (options as { force?: boolean }).force === true;
				forceFinalResponse = force;
				finalText = force ? text : "";
			},
			respondInThread: async () => {
				// Suppress tool chatter on form ingress.
			},
			setTyping: async () => {
				// No-op.
			},
			uploadFile: async (filePath: string, title?: string) => {
				throw new Error(`Website form ingress cannot upload local file ${title || filePath}; use another channel.`);
			},
			setWorking: async (working: boolean) => {
				if (!working && forceFinalResponse && finalText.trim()) {
					await this.postMessage(event.channel, finalText.trim());
				}
			},
			deleteMessage: async () => {
				// No-op.
			},
			restartWorking: async () => {
				finalText = "";
			},
		};
	}

	private upsertChannel(payload: FormInboundPayload): FormChannelRecord {
		const identity = visitorIdentity(payload);
		const channelId = `form-${createHash("sha256").update(`${payload.site.id}:${identity}`).digest("hex").slice(0, 20)}`;
		const displayName = `${payload.site.slug}/${displayVisitor(payload)}`;
		const record: FormChannelRecord = {
			...(this.channels.get(channelId) || {} as FormChannelRecord),
			channelId,
			siteId: payload.site.id,
			siteSlug: payload.site.slug,
			displayName,
			visitorIdentity: identity,
			lastSubmissionId: payload.submissionId,
			updatedAt: new Date().toISOString(),
		};
		this.channels.set(channelId, record);
		return record;
	}

	private resolveChannel(channel: string): FormChannelRecord {
		const record = this.channels.get(channel);
		if (record) return record;
		throw new Error(`Unknown form channel: ${channel}. Ask the visitor to submit the form first or use list_channels.`);
	}
}

function validatePayload(payload: FormInboundPayload): string | null {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) return "payload";
	if (payload.source !== "website_form") return "source";
	if (!isNonEmptyString(payload.submissionId)) return "submissionId";
	if (!isNonEmptyString(payload.submittedAt)) return "submittedAt";
	if (!payload.site || typeof payload.site !== "object" || Array.isArray(payload.site)) return "site";
	if (!isNonEmptyString(payload.site.id)) return "site.id";
	if (!isNonEmptyString(payload.site.slug)) return "site.slug";
	if (!isNonEmptyString(payload.site.displayName)) return "site.displayName";
	if (!isFieldMap(payload.fields)) return "fields";
	if (payload.fieldOrder !== undefined && !isStringArray(payload.fieldOrder)) return "fieldOrder";
	if (payload.visitor !== undefined && !isOptionalStringRecord(payload.visitor, ["name", "email", "phone"])) return "visitor";
	if (payload.form !== undefined && !isOptionalStringRecord(payload.form, ["id", "pageUrl"])) return "form";
	return null;
}

function isNonEmptyString(value: unknown): value is string {
	return typeof value === "string" && value.trim().length > 0;
}

function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isFieldMap(value: unknown): value is Record<string, FieldValue> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	return Object.entries(value).every(([key, fieldValue]) => (
		typeof key === "string"
		&& (
			typeof fieldValue === "string"
			|| (Array.isArray(fieldValue) && fieldValue.every((item) => typeof item === "string"))
		)
	));
}

function isOptionalStringRecord(value: unknown, allowedKeys: string[]): value is Record<string, string | undefined> {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const allowed = new Set(allowedKeys);
	return Object.entries(value).every(([key, fieldValue]) => (
		allowed.has(key)
		&& (fieldValue === undefined || typeof fieldValue === "string" || fieldValue === null)
	));
}

function visitorIdentity(payload: FormInboundPayload): string {
	const visitor = payload.visitor || {};
	const value = visitor.email || visitor.phone || visitor.name || payload.metadata?.ip || payload.submissionId;
	return String(value).trim().toLowerCase();
}

function displayVisitor(payload: FormInboundPayload): string {
	const visitor = payload.visitor || {};
	return visitor.name || visitor.email || visitor.phone || "website visitor";
}

function buildSubmissionText(payload: FormInboundPayload): string {
	const lines = [
		"New website form submission",
		"",
		`Site: ${payload.site.displayName} (${payload.site.slug})`,
		...(payload.form?.id ? [`Form: ${payload.form.id}`] : []),
		...(payload.form?.pageUrl ? [`Page: ${payload.form.pageUrl}`] : []),
		`Submitted: ${payload.submittedAt}`,
	];
	const visitorLine = [
		payload.visitor?.name,
		payload.visitor?.email ? `<${payload.visitor.email}>` : "",
		payload.visitor?.phone,
	].filter(Boolean).join(" ");
	if (visitorLine) lines.push(`Visitor: ${visitorLine}`);
	lines.push("", "Fields:");

	const order = payload.fieldOrder?.length ? payload.fieldOrder : Object.keys(payload.fields);
	for (const key of order) {
		if (!Object.prototype.hasOwnProperty.call(payload.fields, key)) continue;
		lines.push(`- ${key}: ${fieldValueText(payload.fields[key])}`);
	}
	return lines.join("\n");
}

function fieldValueText(value: FieldValue): string {
	return Array.isArray(value) ? value.join(", ") : value;
}

function toIsoDate(value: string): string {
	const numeric = Number(value);
	if (!Number.isNaN(numeric)) {
		return new Date(numeric > 10_000_000_000 ? numeric : numeric * 1000).toISOString();
	}
	const parsed = new Date(value);
	return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}
