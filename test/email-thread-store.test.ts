/**
 * Unit tests for email thread event store.
 *
 * Run: npx tsx test/email-thread-store.test.ts
 */

import { mkdirSync, rmSync } from "fs";
import { join } from "path";
import {
	appendInbound,
	appendOutbound,
	findByMessageId,
	recentThreads,
	summarizeThread,
} from "../src/adapters/email/thread-store.js";

const DIR = `/tmp/email-thread-store-test-${Date.now()}`;
mkdirSync(DIR, { recursive: true });

let passed = 0;
let failed = 0;

function eq<T>(actual: T, expected: T, label: string) {
	const ok = JSON.stringify(actual) === JSON.stringify(expected);
	if (ok) {
		passed++;
		console.log(`PASS ${label}`);
	} else {
		failed++;
		console.log(`FAIL ${label}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
	}
}

function truthy(val: unknown, label: string) {
	if (val) {
		passed++;
		console.log(`PASS ${label}`);
	} else {
		failed++;
		console.log(`FAIL ${label}: expected truthy, got ${JSON.stringify(val)}`);
	}
}

// 1. Inbound append
const r1 = appendInbound(DIR, {
	from: "alex@example.com",
	to: "zip@tinyfat.com",
	subject: "Project Update",
	messageId: "<msg-1@example.com>",
	allRecipients: ["alex@example.com", "carol@example.com", "zip@tinyfat.com"],
	channelId: "email-alex_example_com",
});
eq(r1.type, "inbound", "inbound event records type=inbound");
truthy(r1.threadKey, "inbound event has threadKey");
eq(r1.messageId, "msg-1@example.com", "inbound canonicalized messageId");

// 2. Outbound append into the same thread
const r2 = appendOutbound(DIR, {
	threadKey: r1.threadKey,
	to: ["alex@example.com", "carol@example.com"],
	subject: "Re: Project Update",
	providerMessageId: "resend-id-abc",
	rfcMessageId: "<reply-1@tinyfat.com>",
	inReplyTo: "msg-1@example.com",
	channelId: "email-alex_example_com",
});
eq(r2.providerMessageId, "resend-id-abc", "outbound carries provider id");
truthy(r2.references.includes("msg-1@example.com"), "outbound merges inReplyTo into references");

// 3. Reply lands in same thread via inReplyTo
const r3 = appendInbound(DIR, {
	from: "alex@example.com",
	to: "zip@tinyfat.com",
	subject: "Re: Project Update",
	messageId: "<msg-2@example.com>",
	inReplyTo: "<reply-1@tinyfat.com>",
	references: "<msg-1@example.com> <reply-1@tinyfat.com>",
	allRecipients: ["alex@example.com", "carol@example.com", "zip@tinyfat.com"],
	channelId: "email-alex_example_com",
});
eq(r3.threadKey, r1.threadKey, "reply lands in same thread via references");

// 4. Summary fold
const summary = summarizeThread(DIR, r1.threadKey);
truthy(summary, "summarizeThread returns a summary");
eq(summary!.lastInboundMessageId, "msg-2@example.com", "summary tracks last inbound");
eq(summary!.lastOutboundMessageId, "reply-1@tinyfat.com", "summary tracks last outbound");
eq(summary!.selfEmail, "zip@tinyfat.com", "summary captures self email");
eq(
	summary!.participants.sort(),
	["alex@example.com", "carol@example.com"].sort(),
	"summary excludes self from participants",
);

// 5. findByMessageId
const found = findByMessageId(DIR, "<msg-1@example.com>");
truthy(found, "findByMessageId resolves a known inbound");
eq(found!.threadKey, r1.threadKey, "findByMessageId returns correct event");

// 6. Cold-start replay: drop in-process state, only the file should drive resolution
const summaryAfterRestart = summarizeThread(DIR, r1.threadKey);
eq(summaryAfterRestart!.threadKey, r1.threadKey, "summary survives across calls (cold-start proxy)");

// 7. Second thread does not merge with first
const otherThread = appendInbound(DIR, {
	from: "diane@elsewhere.com",
	to: "zip@tinyfat.com",
	subject: "Different conversation",
	messageId: "<msg-other-1@elsewhere.com>",
	channelId: "email-diane_elsewhere_com",
});
if (otherThread.threadKey === r1.threadKey) {
	failed++;
	console.log(`FAIL different conversations got merged into one thread`);
} else {
	passed++;
	console.log(`PASS different conversations stay distinct`);
}

// 8. recentThreads
const recents = recentThreads(DIR, 10);
truthy(recents.length >= 2, "recentThreads returns multiple threads");
eq(recents[0].threadKey, otherThread.threadKey, "recentThreads is most-recent first");

rmSync(DIR, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
