/**
 * Regression tests for tinyfatco/troublemaker#13 — RFC 5322 References /
 * In-Reply-To construction.
 *
 * Run: npx tsx test/references-construction.test.ts
 */

import { mkdirSync, rmSync } from "fs";
import {
	appendInbound,
	appendOutbound,
	findByThreadKey,
} from "../src/adapters/email/thread-store.js";
import {
	looksLikeMessageId,
	parseReferences,
} from "../src/adapters/email/thread-normalize.js";

const DIR = `/tmp/refs-construction-test-${Date.now()}`;
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

function falsy(val: unknown, label: string) {
	if (!val) {
		passed++;
		console.log(`PASS ${label}`);
	} else {
		failed++;
		console.log(`FAIL ${label}: expected falsy, got ${JSON.stringify(val)}`);
	}
}

// ───── Defect 3: parseReferences should reject non-Message-ID tokens ─────

eq(
	parseReferences("<a@x.com> <b@y.com>"),
	["a@x.com", "b@y.com"],
	"parseReferences accepts well-formed References header",
);

eq(
	parseReferences('["<a@x.com>","<b@y.com>"]'),
	[],
	"parseReferences rejects a JSON-array-string serialized as one token (the issue-11 regression shape)",
);

eq(
	parseReferences("<a@x.com> not-an-email <b@y.com>"),
	["a@x.com", "b@y.com"],
	"parseReferences drops mid-chain garbage tokens",
);

eq(
	parseReferences("garbage,with,commas@notvalid"),
	[],
	"parseReferences drops comma-laden tokens",
);

// ───── looksLikeMessageId edge cases ─────

truthy(looksLikeMessageId("a@x.com"), "looksLikeMessageId: bare addr");
truthy(
	looksLikeMessageId("0100019e24c98690-8ce6b3d6-cc77-464a@email.amazonses.com"),
	"looksLikeMessageId: SES-style id",
);
falsy(looksLikeMessageId(""), "looksLikeMessageId: empty");
falsy(looksLikeMessageId("no-at-sign"), "looksLikeMessageId: no @");
falsy(looksLikeMessageId('["<a@x.com>"]'), "looksLikeMessageId: JSON array string");
falsy(looksLikeMessageId("a@b c@d"), "looksLikeMessageId: multi-@ with space");
falsy(
	looksLikeMessageId("a@x.com,b@y.com"),
	"looksLikeMessageId: comma-joined ids",
);

// ───── Defect 1+2 fixture: outbound references chain construction ─────
//
// Simulate a multi-turn thread and verify that the second outbound's References
// chain is `parent.rawReferences + parent.messageId` (RFC §3.6.4), not the
// summary union.

// Inbound A: thread root.
const inA = appendInbound(DIR, {
	from: "alex@example.com",
	to: "agent@tinyfat.com",
	subject: "Thread root",
	messageId: "<a@example.com>",
	references: undefined, // root has none
	channelId: "email-alex_example_com",
});
truthy(inA, "inbound A appended");

// Outbound 1: agent replies to inbound A.
const out1 = appendOutbound(DIR, {
	threadKey: inA.threadKey,
	to: ["alex@example.com"],
	subject: "Re: Thread root",
	rfcMessageId: "<reply1@tinyfat.com>",
	inReplyTo: "<a@example.com>",
	rawReferences: "<a@example.com>", // parent had no References, so chain = parent ID only
	channelId: "email-alex_example_com",
});
eq(out1.rawReferences, "<a@example.com>", "outbound 1 captures rawReferences");

// Inbound B: user replies to our reply. Their References header should include
// both our reply's ID and the root.
const inB = appendInbound(DIR, {
	from: "alex@example.com",
	to: "agent@tinyfat.com",
	subject: "Re: Thread root",
	messageId: "<b@example.com>",
	inReplyTo: "<reply1@tinyfat.com>",
	references: "<a@example.com> <reply1@tinyfat.com>",
	channelId: "email-alex_example_com",
});
eq(
	inB.rawReferences,
	"<a@example.com> <reply1@tinyfat.com>",
	"inbound B persists rawReferences verbatim",
);
eq(inB.threadKey, inA.threadKey, "inbound B lands in same thread as A");

// Verify what the outbound 2 (agent's next reply) *should* construct:
// References = parent's rawReferences + " " + parent's Message-ID in brackets.
const allEvents = findByThreadKey(DIR, inA.threadKey);
const lastInbound = [...allEvents].reverse().find((e) => e.type === "inbound");
truthy(lastInbound, "findByThreadKey can locate the last inbound");
eq(lastInbound?.messageId, "b@example.com", "last inbound = inbound B");
const expectedRawRefs = `${lastInbound?.rawReferences?.trim()} <${lastInbound?.messageId}>`;
eq(
	expectedRawRefs,
	"<a@example.com> <reply1@tinyfat.com> <b@example.com>",
	"outbound 2 References computes parent.rawReferences + parent.messageId",
);

// And In-Reply-To should be the parent we're responding to (last inbound),
// NOT the agent's own last outbound (defect 2).
eq(
	lastInbound?.messageId,
	"b@example.com",
	"outbound 2 In-Reply-To points at the user's message (b), not our own reply1",
);

rmSync(DIR, { recursive: true, force: true });

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
