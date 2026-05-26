import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { SlackBase, type SlackBaseConfig } from "../src/adapters/slack-base.js";
import type { MomEvent } from "../src/adapters/types.js";
import type { ChannelStore } from "../src/store.js";
import { createSendMessageToChannelTool } from "../src/tools/send-message-to-channel.js";

type PostedMessage = {
	channel: string;
	text: string;
	thread_ts?: string;
};

let passed = 0;
let failed = 0;

function assert(condition: boolean, msg: string) {
	if (condition) {
		passed++;
		console.log(`  ✓ ${msg}`);
	} else {
		failed++;
		console.error(`  ✗ ${msg}`);
	}
}

function assertEqual<T>(actual: T, expected: T, msg: string) {
	assert(actual === expected, `${msg} (got ${String(actual)}, expected ${String(expected)})`);
}

class TestSlackAdapter extends SlackBase {
	posted: PostedMessage[] = [];

	constructor(workingDir: string) {
		const store = { processAttachments: () => [] } as unknown as ChannelStore;
		const config: SlackBaseConfig = { botToken: "xoxb-test", workingDir, store };
		super(config);
		this.webClient = {
			chat: {
				postMessage: async (payload: PostedMessage) => {
					this.posted.push(payload);
					return { ts: `posted-${this.posted.length}` };
				},
				update: async () => {},
				delete: async () => {},
			},
			files: {
				uploadV2: async () => {},
			},
		} as any;
	}

	async start(): Promise<void> {}
	async stop(): Promise<void> {}
}

function event(overrides: Partial<MomEvent> = {}): MomEvent {
	return {
		type: "mention",
		channel: "C123",
		ts: "1710000000.000100",
		user: "U123",
		text: "hello",
		...overrides,
	};
}

async function run() {
	const dir = mkdtempSync(join(tmpdir(), "tm-slack-thread-"));
	try {
		const adapter = new TestSlackAdapter(dir);

		await adapter.runWithEventScope(event(), async () => {
			await adapter.postMessage("C123", "same channel");
			await adapter.postMessage("C999", "cross channel");
		});

		assertEqual(adapter.posted[0]?.thread_ts, "1710000000.000100", "same-channel Slack sends thread under triggering message");
		assertEqual(adapter.posted[1]?.thread_ts, undefined, "cross-channel Slack sends stay top-level");

		adapter.posted.length = 0;
		await adapter.runWithEventScope(event({ ts: "1710000000.000200", thread_ts: "1710000000.000001" }), async () => {
			await adapter.postMessage("C123", "existing thread");
		});

		assertEqual(adapter.posted[0]?.thread_ts, "1710000000.000001", "existing Slack thread parent is preserved");

		adapter.posted.length = 0;
		await adapter.runWithEventScope(event({ channel: "D123", ts: "1710000000.000300", type: "dm" }), async () => {
			await adapter.postMessage("D123", "plain dm");
		});

		assertEqual(adapter.posted[0]?.thread_ts, undefined, "plain Slack DMs remain top-level");

		adapter.posted.length = 0;
		const ctx = adapter.createContext(event({ thread_ts: "1710000000.000001" }), {} as ChannelStore);
		await ctx.sendFinalResponse("final answer");

		assertEqual(adapter.posted[0]?.thread_ts, "1710000000.000001", "Slack context final responses use inbound thread");

		adapter.posted.length = 0;
		const tool = createSendMessageToChannelTool([adapter]);
		await adapter.runWithEventScope(event({ thread_ts: "1710000000.000001" }), async () => {
			await (tool.execute as any)("call-1", {
				label: "reply in thread",
				channel: "C123",
				text: "tool answer",
			});
		});

		assertEqual(adapter.posted[0]?.thread_ts, "1710000000.000001", "send_message_to_channel inherits active Slack thread");
	} finally {
		rmSync(dir, { recursive: true, force: true });
	}

	console.log(`\n${passed} passed, ${failed} failed`);
	process.exit(failed > 0 ? 1 : 0);
}

run().catch((err) => {
	console.error("Test error:", err);
	process.exit(1);
});
