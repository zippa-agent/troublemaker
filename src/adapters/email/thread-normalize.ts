/**
 * Pure normalization helpers for email threading.
 *
 * No I/O, no side effects. Every function is a deterministic transform on a
 * subset of an inbound or outbound email's metadata. Tested in isolation; the
 * thread-store layer composes these to produce stable thread keys.
 */

/**
 * Canonicalize a Message-ID:
 *   - strip surrounding whitespace
 *   - strip surrounding angle brackets if present
 *   - lowercase the domain portion (left of `@` stays case-sensitive per RFC 5322 §3.6.4)
 *
 * Returns an empty string if the input has no usable content.
 */
export function canonicalMessageId(raw: string | undefined | null): string {
	if (!raw) return "";
	let s = raw.trim();
	if (s.startsWith("<") && s.endsWith(">")) {
		s = s.slice(1, -1);
	}
	const at = s.lastIndexOf("@");
	if (at === -1) return s;
	return s.slice(0, at) + "@" + s.slice(at + 1).toLowerCase();
}

/**
 * Normalize a Subject header into a stable thread key:
 *   - strip leading Re:/Fwd:/Fw: (any case, any number of repetitions)
 *   - collapse internal whitespace
 *   - lowercase
 *   - trim
 *
 * Empty subjects normalize to an empty string; callers fall back to the
 * Message-ID for thread keying when this returns empty.
 */
export function normalizeSubject(subject: string | undefined | null): string {
	if (!subject) return "";
	let s = subject.replace(/^(?:\s*(?:re|fwd?|fw):)+\s*/i, "");
	s = s.replace(/\s+/g, " ").trim().toLowerCase();
	return s;
}

/**
 * Normalize a participant string (From/To/Cc/Bcc value) to a bare lowercased
 * email address. Strips display name and angle brackets. Returns "" for
 * unparseable input.
 */
export function normalizeParticipant(raw: string | undefined | null): string {
	if (!raw) return "";
	const trimmed = raw.trim();
	const angle = trimmed.match(/<([^>]+)>/);
	const addr = (angle ? angle[1] : trimmed).trim().toLowerCase();
	if (!addr.includes("@")) return "";
	return addr;
}

/** Normalize a list of participant strings, dedupe, drop empties. Stable order. */
export function normalizeParticipants(values: Array<string | undefined | null> | undefined): string[] {
	if (!values) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const v of values) {
		const n = normalizeParticipant(v);
		if (!n || seen.has(n)) continue;
		seen.add(n);
		out.push(n);
	}
	return out;
}

/**
 * Parse a References header (space-separated Message-IDs in angle brackets) into
 * a canonicalized, deduped list preserving first-occurrence order.
 */
export function parseReferences(raw: string | undefined | null): string[] {
	if (!raw) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	const tokens = raw.split(/\s+/);
	for (const tok of tokens) {
		const id = canonicalMessageId(tok);
		if (!id || seen.has(id)) continue;
		seen.add(id);
		out.push(id);
	}
	return out;
}

/**
 * Merge an existing References chain with new ids (inReplyTo, prior references).
 * First-occurrence order preserved; dedupes by canonical form.
 */
export function mergeReferences(existing: string[], add: Array<string | undefined>): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const id of [...existing, ...add]) {
		const c = canonicalMessageId(id || "");
		if (!c || seen.has(c)) continue;
		seen.add(c);
		out.push(c);
	}
	return out;
}

/**
 * Build the stable thread key used to find an EmailThreadRef. Prefers the
 * earliest known Message-ID in the chain (root of conversation); falls back to a
 * deterministic hash of (normalizedSubject + sorted participants) when no
 * Message-ID is available.
 */
export function buildThreadKey(input: {
	references?: string[];
	inReplyTo?: string;
	messageId?: string;
	subject?: string;
	participants?: string[];
}): string {
	const refs = input.references ?? [];
	if (refs.length > 0) {
		return refs[0];
	}
	const inReply = canonicalMessageId(input.inReplyTo);
	if (inReply) return inReply;
	const own = canonicalMessageId(input.messageId);
	if (own) return own;
	const subj = normalizeSubject(input.subject);
	const parts = (input.participants ?? []).slice().sort().join(",");
	const seed = `${subj}|${parts}`;
	return `subject:${djb2(seed)}`;
}

function djb2(s: string): string {
	let h = 5381;
	for (let i = 0; i < s.length; i++) {
		h = ((h << 5) + h + s.charCodeAt(i)) | 0;
	}
	return (h >>> 0).toString(36);
}
