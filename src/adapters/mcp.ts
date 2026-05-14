/**
 * MCP Adapter — exposes agent tools over MCP Streamable HTTP.
 *
 * Runs inside the container on the gateway's shared HTTP port (3002).
 * Auth is handled by crawdad-cf before proxying here.
 *
 * Uses the Node.js StreamableHTTPServerTransport (wraps Web Standard
 * transport internally via @hono/node-server).
 */

import { exec as execCb } from "child_process";
import { appendFileSync } from "fs";
import type { IncomingMessage, ServerResponse } from "http";
import { basename, join } from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";
import * as log from "../log.js";
import { appendAwarenessLine } from "../awareness.js";
import type { ChannelStore } from "../store.js";
import { collectChannelsFromLog, formatChannelTable } from "../tools/list-channels.js";
import { recentThreads } from "./email/thread-store.js";
import type { SendMessageRequest } from "../messaging/send-message.js";
import { SendMessageValidationError, validateSendMessage } from "../messaging/send-message.js";
import {
	adapterForChannelId,
	decodeThreadRef,
	encodeThreadRef,
	type EmailThreadRef,
	type ThreadRef,
} from "../messaging/targets.js";
import type {
	ChannelInfo,
	MomContext,
	MomEvent,
	MomHandler,
	PlatformAdapter,
	UserInfo,
} from "./types.js";

export interface McpAdapterConfig {
	workingDir: string;
}

export class McpAdapter implements PlatformAdapter {
	readonly name = "mcp";
	readonly maxMessageLength = 100000;
	readonly formatInstructions = `You are responding via MCP (Model Context Protocol). Return plain text results. Be concise and precise.`;

	private workingDir: string;
	private handler!: MomHandler;
	private peerAdapters: PlatformAdapter[] = [];
	private awarenessDir?: string;

	constructor(config: McpAdapterConfig) {
		this.workingDir = config.workingDir;
	}

	setHandler(handler: MomHandler): void {
		this.handler = handler;
	}

	/**
	 * Inject the full adapter list and awareness dir after construction.
	 * Called from main.ts once all adapters are built. Lets MCP tools route
	 * sends through other adapters and append to the agent's awareness stream.
	 */
	setAdapters(adapters: PlatformAdapter[], awarenessDir: string): void {
		this.peerAdapters = adapters;
		this.awarenessDir = awarenessDir;
	}

	async start(): Promise<void> {
		if (!this.handler) throw new Error("McpAdapter: handler not set. Call setHandler() before start().");
		log.logInfo("MCP adapter ready");
	}

	async stop(): Promise<void> {}

	/**
	 * Handle inbound MCP request — called by Gateway for POST /mcp.
	 * Creates a fresh stateless MCP server per request.
	 */
	dispatch(req: IncomingMessage, res: ServerResponse): void {
		// VPS mode: verify X-Tools-Token header to prevent unauthenticated access
		// through the Cloudflare Tunnel. Without this, anyone who knows the tunnel
		// hostname can execute arbitrary commands.
		const requiredToken = process.env.MOM_MCP_AUTH_TOKEN;
		if (requiredToken) {
			const provided = req.headers["x-tools-token"];
			if (provided !== requiredToken) {
				res.writeHead(401, { "Content-Type": "application/json" });
				res.end(JSON.stringify({
					jsonrpc: "2.0",
					error: { code: -32001, message: "Unauthorized" },
					id: null,
				}));
				return;
			}
		}

		this.handleMcpRequest(req, res).catch((err) => {
			log.logWarning("MCP request error", err instanceof Error ? err.message : String(err));
			if (!res.headersSent) {
				res.writeHead(500, { "Content-Type": "application/json" });
			}
			res.end(JSON.stringify({
				jsonrpc: "2.0",
				error: { code: -32603, message: "Internal error" },
				id: null,
			}));
		});
	}

	private async handleMcpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
		const server = new McpServer(
			{ name: "tinyfat-computer", version: "1.0.0" },
			{ capabilities: { tools: {} } },
		);

		this.registerTools(server);

		const transport = new StreamableHTTPServerTransport({
			sessionIdGenerator: undefined, // Stateless
			enableJsonResponse: true,
		});

		await server.connect(transport);

		try {
			await transport.handleRequest(req, res);
		} finally {
			await transport.close().catch(() => {});
			await server.close().catch(() => {});
		}
	}

	private exec(command: string): Promise<{ stdout: string; stderr: string; code: number }> {
		return new Promise((resolve) => {
			execCb(command, {
				cwd: this.workingDir,
				timeout: 120_000,
				maxBuffer: 10 * 1024 * 1024,
				encoding: "utf-8",
			}, (err, stdout, stderr) => {
				if (err) {
					const e = err as { code?: number; killed?: boolean };
					resolve({
						stdout: (stdout as string) || "",
						stderr: (stderr as string) || err.message || "Command failed",
						code: e.code ?? 1,
					});
				} else {
					resolve({ stdout: stdout as string, stderr: stderr as string, code: 0 });
				}
			});
		});
	}

	private shellEscape(s: string): string {
		return `'${s.replace(/'/g, "'\\''")}'`;
	}

	private registerTools(server: McpServer): void {
		// ── execute ──────────────────────────────────────────────────────
		server.registerTool(
			"bash",
			{
				description: "Run a shell command on your TinyFat computer. Returns stdout/stderr.",
				inputSchema: { command: z.string().describe("Shell command to execute") },
			},
			async ({ command }: { command: string }) => {
				log.logInfo(`[mcp] bash: ${command.substring(0, 100)}`);
				const result = await this.exec(command);

				this.logToFile({
					date: new Date().toISOString(),
					channel: "mcp",
					type: "tool_call",
					tool: "bash",
					command,
					success: result.code === 0,
					...(result.code !== 0 && { exitCode: result.code }),
				});

				const output = result.code === 0
					? result.stdout || "(no output)"
					: [result.stdout, result.stderr].filter(Boolean).join("\n");

				return {
					content: [{ type: "text" as const, text: output }],
					...(result.code !== 0 && { isError: true }),
				};
			},
		);

		// ── read ─────────────────────────────────────────────────────────
		server.registerTool(
			"read",
			{
				description: "Read the contents of a file. Use offset/limit for large files.",
				inputSchema: {
					path: z.string().describe("Path to the file to read (relative or absolute)"),
					offset: z.number().optional().describe("Line number to start reading from (1-indexed)"),
					limit: z.number().optional().describe("Maximum number of lines to read"),
				},
			},
			async ({ path, offset, limit }: { path: string; offset?: number; limit?: number }) => {
				log.logInfo(`[mcp] read: ${path}`);
				const escaped = this.shellEscape(path);

				// Get total lines
				const countResult = await this.exec(`wc -l < ${escaped}`);
				if (countResult.code !== 0) {
					return { content: [{ type: "text" as const, text: countResult.stderr }], isError: true };
				}
				const totalLines = parseInt(countResult.stdout.trim(), 10) + 1;

				const startLine = offset ? Math.max(1, offset) : 1;
				if (startLine > totalLines) {
					return { content: [{ type: "text" as const, text: `Offset ${offset} is beyond end of file (${totalLines} lines)` }], isError: true };
				}

				let cmd = startLine === 1 ? `cat ${escaped}` : `tail -n +${startLine} ${escaped}`;
				if (limit) {
					cmd += ` | head -n ${limit}`;
				}

				const result = await this.exec(cmd);
				if (result.code !== 0) {
					return { content: [{ type: "text" as const, text: result.stderr }], isError: true };
				}

				const readLines = result.stdout.split("\n").length;
				const endLine = startLine + readLines - 1;
				let text = result.stdout;
				if (endLine < totalLines) {
					text += `\n\n[Showing lines ${startLine}-${endLine} of ${totalLines}. Use offset=${endLine + 1} to continue]`;
				}

				this.logToFile({ date: new Date().toISOString(), channel: "mcp", type: "tool_call", tool: "read", path, success: true });
				return { content: [{ type: "text" as const, text }] };
			},
		);

		// ── write ────────────────────────────────────────────────────────
		server.registerTool(
			"write",
			{
				description: "Write content to a file. Creates the file if it doesn't exist, overwrites if it does. Automatically creates parent directories.",
				inputSchema: {
					path: z.string().describe("Path to the file to write (relative or absolute)"),
					content: z.string().describe("Content to write to the file"),
				},
			},
			async ({ path, content }: { path: string; content: string }) => {
				log.logInfo(`[mcp] write: ${path} (${content.length} bytes)`);
				const escaped = this.shellEscape(path);
				const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : ".";

				const cmd = `mkdir -p ${this.shellEscape(dir)} && printf '%s' ${this.shellEscape(content)} > ${escaped}`;
				const result = await this.exec(cmd);

				this.logToFile({ date: new Date().toISOString(), channel: "mcp", type: "tool_call", tool: "write", path, success: result.code === 0 });

				if (result.code !== 0) {
					return { content: [{ type: "text" as const, text: result.stderr }], isError: true };
				}
				return { content: [{ type: "text" as const, text: `Wrote ${content.length} bytes to ${path}` }] };
			},
		);

		// ── edit ─────────────────────────────────────────────────────────
		server.registerTool(
			"edit",
			{
				description: "Edit a file by replacing exact text. The old_text must match exactly one occurrence (including whitespace).",
				inputSchema: {
					path: z.string().describe("Path to the file to edit (relative or absolute)"),
					old_text: z.string().describe("Exact text to find and replace (must match exactly)"),
					new_text: z.string().describe("New text to replace the old text with"),
				},
			},
			async ({ path, old_text, new_text }: { path: string; old_text: string; new_text: string }) => {
				log.logInfo(`[mcp] edit: ${path}`);
				const escaped = this.shellEscape(path);

				// Read file
				const readResult = await this.exec(`cat ${escaped}`);
				if (readResult.code !== 0) {
					return { content: [{ type: "text" as const, text: `File not found: ${path}` }], isError: true };
				}

				const fileContent = readResult.stdout;

				if (!fileContent.includes(old_text)) {
					return { content: [{ type: "text" as const, text: `Could not find the exact text in ${path}. Must match exactly including whitespace.` }], isError: true };
				}

				const occurrences = fileContent.split(old_text).length - 1;
				if (occurrences > 1) {
					return { content: [{ type: "text" as const, text: `Found ${occurrences} occurrences in ${path}. Must be unique — provide more context.` }], isError: true };
				}

				const idx = fileContent.indexOf(old_text);
				const newContent = fileContent.substring(0, idx) + new_text + fileContent.substring(idx + old_text.length);

				const writeResult = await this.exec(`printf '%s' ${this.shellEscape(newContent)} > ${escaped}`);
				if (writeResult.code !== 0) {
					return { content: [{ type: "text" as const, text: writeResult.stderr }], isError: true };
				}

				this.logToFile({ date: new Date().toISOString(), channel: "mcp", type: "tool_call", tool: "edit", path, success: true });
				return { content: [{ type: "text" as const, text: `Replaced ${old_text.length} chars with ${new_text.length} chars in ${path}` }] };
			},
		);

		// ── send_message ─────────────────────────────────────────────────
		// Explicit, validated send. Exactly one of `to` or `thread` must be
		// provided. `replyAll` is email-only and requires `thread`. Surfaces
		// resolved recipients + provider id in the result so the audit trail
		// is explicit. Appears in the agent's awareness stream but does NOT
		// trigger a runner wake.
		server.registerTool(
			"send_message",
			{
				description:
					"Send a message on the agent's behalf. Exactly one of `to` or `thread` must be provided. " +
					"`to` is a channel id (numeric Telegram, C/D/G Slack, email-{addr}, phone-{hash}) or an email address. " +
					"`thread` is an opaque ThreadRef (see list_threads). `replyAll` is email-only and requires `thread`.",
				inputSchema: {
					to: z.string().optional().describe("Channel id or email address (fresh send)"),
					thread: z.string().optional().describe("Opaque ThreadRef for replying (see list_threads)"),
					replyAll: z.boolean().optional().describe("Email-only. Requires thread."),
					subject: z.string().optional().describe("Subject line (email only)"),
					text: z.string().describe("Message body"),
					attachments: z.array(z.string()).optional().describe("Absolute file paths to attach (email only)"),
				},
			},
			async ({ to, thread, replyAll, subject, text, attachments }: { to?: string; thread?: string; replyAll?: boolean; subject?: string; text: string; attachments?: string[] }) => {
				log.logInfo(`[mcp] send_message: to=${to ?? ""} thread=${thread ?? ""} (${text.length} chars)`);

				let threadRef: ThreadRef | undefined;
				if (thread) {
					threadRef = decodeThreadRef(thread);
					if (!threadRef) {
						return { content: [{ type: "text" as const, text: `send_message: unable to decode thread ref "${thread}"` }], isError: true };
					}
				}
				let parsedTo: SendMessageRequest["to"];
				if (to) {
					if (to.includes("@") && !to.startsWith("email-")) {
						parsedTo = { kind: "contact", adapter: "email", address: to.toLowerCase() };
					} else {
						parsedTo = { kind: "channel", id: to };
					}
				}

				let request: SendMessageRequest;
				try {
					request = validateSendMessage({
						to: parsedTo,
						thread: threadRef,
						replyAll,
						subject,
						text,
						attachments: attachments?.map((p) => ({ filePath: p, filename: basename(p) })),
					});
				} catch (err) {
					const msg = err instanceof SendMessageValidationError ? err.message : String(err);
					return { content: [{ type: "text" as const, text: msg }], isError: true };
				}

				const adapterName = threadRef ? threadRef.adapter
					: parsedTo && !Array.isArray(parsedTo) && parsedTo.kind === "channel" ? adapterForChannelId(parsedTo.id)
						: parsedTo && !Array.isArray(parsedTo) && parsedTo.kind === "contact" ? parsedTo.adapter
							: undefined;

				const adapter = adapterName ? this.peerAdapters.find((a) => a.name === adapterName) : undefined;
				if (!adapter || !adapter.sendMessage) {
					return { content: [{ type: "text" as const, text: `send_message: no adapter available for ${adapterName ?? "<unknown>"}` }], isError: true };
				}

				try {
					const result = await adapter.sendMessage(request);
					if (this.awarenessDir) {
						const preview = text.length > 200 ? `${text.slice(0, 200)}…` : text;
						appendAwarenessLine(
							this.awarenessDir,
							`[mcp] sent via ${result.adapter} to ${result.resolvedRecipients.join(",")}: ${preview}`,
						);
					}
					this.logToFile({
						date: new Date().toISOString(),
						channel: "mcp",
						type: "tool_call",
						tool: "send_message",
						target_adapter: result.adapter,
						resolved_recipients: result.resolvedRecipients,
						thread_ref: result.threadRef,
						provider_message_id: result.providerMessageId,
						success: true,
					});
					const summary = [
						`Sent via ${result.adapter}`,
						`recipients: ${result.resolvedRecipients.join(", ")}`,
						result.resolvedSubject ? `subject: ${result.resolvedSubject}` : "",
						result.threadRef ? `thread: ${result.threadRef}` : "",
						`provider id: ${result.providerMessageId}`,
					].filter(Boolean).join("\n");
					return { content: [{ type: "text" as const, text: summary }] };
				} catch (err) {
					const errMsg = err instanceof Error ? err.message : String(err);
					log.logWarning(`[mcp] send_message failed`, errMsg);
					this.logToFile({
						date: new Date().toISOString(),
						channel: "mcp",
						type: "tool_call",
						tool: "send_message",
						success: false,
						error: errMsg,
					});
					return { content: [{ type: "text" as const, text: `send_message failed: ${errMsg}` }], isError: true };
				}
			},
		);

		// ── list_threads ─────────────────────────────────────────────────
		server.registerTool(
			"list_threads",
			{
				description:
					"List recent email threads with their ThreadRef. Use the returned ThreadRef as the `thread` arg to send_message.",
				inputSchema: {
					limit: z.number().optional().describe("Max threads to return. Default 20."),
				},
			},
			async ({ limit }: { limit?: number }) => {
				const threads = recentThreads(this.workingDir, limit ?? 20);
				if (threads.length === 0) {
					return { content: [{ type: "text" as const, text: "No threads yet." }] };
				}
				const lines = [
					"| ThreadRef | Subject | Participants | Updated |",
					"|-----------|---------|--------------|---------|",
				];
				for (const t of threads) {
					const ref: EmailThreadRef = { kind: "thread", adapter: "email", id: t.threadKey };
					const subj = (t.subject || "(no subject)").replace(/\|/g, "\\|");
					const parts = t.participants.slice(0, 3).join(", ") + (t.participants.length > 3 ? "…" : "");
					lines.push(`| \`${encodeThreadRef(ref)}\` | ${subj} | ${parts} | ${t.updatedAt} |`);
				}
				return { content: [{ type: "text" as const, text: lines.join("\n") }] };
			},
		);

		// ── list_channels ────────────────────────────────────────────────
		// Discovery helper for MCP clients. Reads log.jsonl so it covers any
		// channel the agent has ever interacted with, regardless of adapter or
		// container lifetime.
		server.registerTool(
			"list_channels",
			{
				description:
					"List every channel the agent has ever sent or received a message on. Reads from " +
					"log.jsonl so it covers Telegram, Slack, Email, Discord, etc. and survives " +
					"container restarts. Returns a markdown table of adapter, channel ID, name, " +
					"and last-seen timestamp. Use the channel IDs returned here as input to " +
					"send_message (`to` argument).",
				inputSchema: {},
			},
			async () => {
				const channels = collectChannelsFromLog(this.workingDir);
				log.logInfo(`[mcp] list_channels: ${channels.length} channels`);
				this.logToFile({
					date: new Date().toISOString(),
					channel: "mcp",
					type: "tool_call",
					tool: "list_channels",
					count: channels.length,
					success: true,
				});
				return { content: [{ type: "text" as const, text: formatChannelTable(channels) }] };
			},
		);
	}

	// ==========================================================================
	// PlatformAdapter — message operations (no-ops for MCP)
	// ==========================================================================

	async postMessage(_channel: string, _text: string): Promise<string> {
		return String(Date.now());
	}

	async updateMessage(_channel: string, _ts: string, _text: string): Promise<void> {}
	async deleteMessage(_channel: string, _ts: string): Promise<void> {}

	async postInThread(_channel: string, _threadTs: string, _text: string): Promise<string> {
		return String(Date.now());
	}

	async uploadFile(_channel: string, _filePath: string, _title?: string): Promise<void> {}

	// ==========================================================================
	// Logging
	// ==========================================================================

	logToFile(entry: object): void {
		try {
			appendFileSync(join(this.workingDir, "log.jsonl"), `${JSON.stringify(entry)}\n`);
		} catch {
			// R2 FUSE mount may have dropped — don't let logging failures kill tool responses
		}
	}

	logBotResponse(_channel: string, _text: string, _ts: string): void {}

	// ==========================================================================
	// Metadata (MCP has no channels/users)
	// ==========================================================================

	getUser(_userId: string): UserInfo | undefined { return undefined; }
	getChannel(_channelId: string): ChannelInfo | undefined { return undefined; }
	getAllUsers(): UserInfo[] { return []; }
	getAllChannels(): ChannelInfo[] { return []; }
	enqueueEvent(_event: MomEvent): boolean { return false; }

	createContext(event: MomEvent, _store: ChannelStore, _isEvent?: boolean): MomContext {
		return {
			message: {
				text: event.text,
				rawText: event.text,
				user: event.user,
				userName: "mcp-client",
				channel: event.channel,
				ts: event.ts,
				attachments: [],
			},
			channelName: undefined,
			channels: [],
			users: [],
			respond: async () => {},
			sendFinalResponse: async () => {},
			respondInThread: async () => {},
			setTyping: async () => {},
			uploadFile: async () => {},
			setWorking: async () => {},
			deleteMessage: async () => {},
			restartWorking: async () => {},
		};
	}
}
