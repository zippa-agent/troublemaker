import assert from "node:assert/strict";
import { slackChannelLogLabel } from "../src/adapters/slack-base.js";

assert.equal(slackChannelLogLabel("D123", "DM:alexgarcia042"), "slack:DM:alexgarcia042");
assert.equal(slackChannelLogLabel("C123", "all-tinyfat"), "slack:#all-tinyfat");
assert.equal(slackChannelLogLabel("C123", "#all-tinyfat"), "slack:#all-tinyfat");
assert.equal(slackChannelLogLabel("C123"), "slack:C123");
assert.equal(slackChannelLogLabel("C123", "slack:#already-normalized"), "slack:#already-normalized");

console.log("slack channel label ok");
