import assert from "node:assert/strict";
import { composeEmailReplyBody } from "../src/adapters/email/reply-composer.js";
import {
	buildEmailReplyQuoteFromThreadEvents,
	parseEmailThreadLedger,
} from "../src/adapters/email/thread-quote.js";

const ledger = parseEmailThreadLedger([
	JSON.stringify({
		type: "inbound",
		at: "2026-06-07T08:00:00.000Z",
		channelId: "email-alex_example_com",
		from: "Alex <alex@example.com>",
		subject: "Edge thread",
		body: "Original request",
		messageId: "<root@example.com>",
	}),
	JSON.stringify({
		type: "outbound",
		at: "2026-06-07T08:01:00.000Z",
		channelId: "email-alex_example_com",
		from: "Zip <zip@tinyfat.com>",
		to: ["alex@example.com"],
		subject: "Re: Edge thread",
		body: "First Zip answer",
		providerMessageId: "<zip-reply@example.com>",
		inReplyTo: "<root@example.com>",
		references: "<root@example.com>",
	}),
	"",
	"{not json",
].join("\n"));

const quote = buildEmailReplyQuoteFromThreadEvents(ledger, {
	channelId: "email-alex_example_com",
	from: "Alex <alex@example.com>",
	fromFull: "Alex <alex@example.com>",
	agentAddress: "Zip <zip@tinyfat.com>",
	subject: "Re: Edge thread",
	body: "Follow-up request",
	messageId: "<follow-up@example.com>",
	inReplyTo: "<zip-reply@example.com>",
	references: "<root@example.com> <zip-reply@example.com>",
	sentAt: "2026-06-07T08:02:00.000Z",
});

assert.ok(quote);
assert.match(quote.body, /^Follow-up request/);
assert.match(quote.body, /First Zip answer/);
assert.match(quote.body, /Original request/);

const replyBody = composeEmailReplyBody("Second Zip answer", quote);
assert.match(replyBody, /^Second Zip answer/);
assert.match(replyBody, /> Follow-up request/);
assert.match(replyBody, /> > First Zip answer/);
assert.match(replyBody, /> > > Original request/);
assert.doesNotMatch(replyBody, /\{not json/);

console.log("email-thread-quote ok");
