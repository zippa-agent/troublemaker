/**
 * Unit tests for the pure thread-normalize helpers.
 *
 * Run: npx tsx test/thread-normalize.test.ts
 */

import {
	buildThreadKey,
	canonicalMessageId,
	mergeReferences,
	normalizeParticipant,
	normalizeParticipants,
	normalizeSubject,
	parseReferences,
} from "../src/adapters/email/thread-normalize.js";

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

// canonicalMessageId
eq(canonicalMessageId("<abc@Example.com>"), "abc@example.com", "canonicalMessageId strips brackets, lowercases domain");
eq(canonicalMessageId("  <Foo@BAR.io>  "), "Foo@bar.io", "canonicalMessageId preserves localpart case");
eq(canonicalMessageId(""), "", "canonicalMessageId empty");
eq(canonicalMessageId(undefined), "", "canonicalMessageId undefined");
eq(canonicalMessageId("no-at-sign"), "no-at-sign", "canonicalMessageId no @ passes through");

// normalizeSubject
eq(normalizeSubject("Re: Re: Project Update"), "project update", "normalizeSubject strips repeated Re:");
eq(normalizeSubject("Fwd: hello"), "hello", "normalizeSubject strips Fwd:");
eq(normalizeSubject("Fw: hi"), "hi", "normalizeSubject strips Fw:");
eq(normalizeSubject("re: RE: fwd: weird"), "weird", "normalizeSubject mixed prefixes");
eq(normalizeSubject("  spaced   out  "), "spaced out", "normalizeSubject collapses whitespace");
eq(normalizeSubject(""), "", "normalizeSubject empty");

// normalizeParticipant
eq(normalizeParticipant("Alex Garcia <alex@TINYFAT.com>"), "alex@tinyfat.com", "normalizeParticipant strips display + brackets");
eq(normalizeParticipant("bare@example.com"), "bare@example.com", "normalizeParticipant bare addr");
eq(normalizeParticipant("garbage"), "", "normalizeParticipant rejects non-email");

// normalizeParticipants
eq(
	normalizeParticipants(["A <a@x.com>", "B <a@X.com>", "c@x.com", undefined, ""]),
	["a@x.com", "c@x.com"],
	"normalizeParticipants dedupes, preserves order",
);

// parseReferences
eq(
	parseReferences("<a@x.com> <B@X.COM> <a@x.com>"),
	["a@x.com", "B@x.com"],
	"parseReferences canonicalizes + dedupes",
);
eq(parseReferences(undefined), [], "parseReferences undefined → []");

// mergeReferences
eq(
	mergeReferences(["root@x.com"], ["<reply@x.com>", "root@x.com"]),
	["root@x.com", "reply@x.com"],
	"mergeReferences dedupes across existing + add",
);

// buildThreadKey
eq(
	buildThreadKey({ references: ["root@x.com", "next@x.com"] }),
	"root@x.com",
	"buildThreadKey prefers references[0]",
);
eq(
	buildThreadKey({ inReplyTo: "<parent@x.com>" }),
	"parent@x.com",
	"buildThreadKey falls back to inReplyTo",
);
eq(
	buildThreadKey({ messageId: "<own@x.com>" }),
	"own@x.com",
	"buildThreadKey falls back to own messageId",
);
{
	const k = buildThreadKey({ subject: "Re: Status", participants: ["b@x.com", "a@x.com"] });
	eq(k.startsWith("subject:"), true, "buildThreadKey final fallback uses subject:");
}
{
	// Same key for swapped participant order.
	const k1 = buildThreadKey({ subject: "Status", participants: ["a@x.com", "b@x.com"] });
	const k2 = buildThreadKey({ subject: "Re: Status", participants: ["b@x.com", "a@x.com"] });
	eq(k1, k2, "buildThreadKey deterministic under participant reorder + Re:");
}

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
