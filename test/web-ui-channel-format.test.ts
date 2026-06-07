import assert from "node:assert/strict";
import { formatChannel } from "../ui/src/types.ts";

assert.deepEqual(formatChannel("slack:DM:Alex Garcia 042"), {
	label: "DM:Alex Garcia 042",
	type: "slack",
});
assert.deepEqual(formatChannel("slack:#tinyfat"), {
	label: "#tinyfat",
	type: "slack",
});
assert.deepEqual(formatChannel("slack:C0AN1GL51K7"), {
	label: "#C0AN1GL51K7",
	type: "slack",
});
assert.deepEqual(formatChannel("telegram:DM:Alex Garcia 042"), {
	label: "DM:Alex Garcia 042",
	type: "telegram",
});
assert.deepEqual(formatChannel("DM:Alex Garcia 042"), {
	label: "DM:Alex Garcia 042",
	type: "telegram",
});

console.log("web-ui-channel-format ok");
