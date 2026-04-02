import type { Env, PlatformResult } from "../types";

interface BlueskySession {
	accessJwt: string;
	did: string;
}

async function createSession(env: Env): Promise<BlueskySession> {
	const response = await fetch(
		"https://bsky.social/xrpc/com.atproto.server.createSession",
		{
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				identifier: env.BLUESKY_HANDLE,
				password: env.BLUESKY_APP_PASSWORD,
			}),
		},
	);

	if (!response.ok) {
		const body = await response.text();
		throw new Error(`Bluesky auth failed: HTTP ${response.status}: ${body}`);
	}

	return (await response.json()) as BlueskySession;
}

function buildFacets(text: string) {
	const facets: Array<{
		index: { byteStart: number; byteEnd: number };
		features: Array<{ $type: string; uri: string }>;
	}> = [];

	const urlRegex = /https?:\/\/[^\s)]+/g;
	let match: RegExpExecArray | null;
	const encoder = new TextEncoder();

	while ((match = urlRegex.exec(text)) !== null) {
		const beforeUrl = text.slice(0, match.index);
		const byteStart = encoder.encode(beforeUrl).length;
		const byteEnd = byteStart + encoder.encode(match[0]).length;

		facets.push({
			index: { byteStart, byteEnd },
			features: [
				{
					$type: "app.bsky.richtext.facet#link",
					uri: match[0],
				},
			],
		});
	}

	return facets;
}

export async function postToBluesky(
	env: Env,
	text: string,
): Promise<PlatformResult> {
	try {
		const session = await createSession(env);
		const facets = buildFacets(text);

		const record: Record<string, unknown> = {
			$type: "app.bsky.feed.post",
			text,
			createdAt: new Date().toISOString(),
		};
		if (facets.length > 0) {
			record.facets = facets;
		}

		const response = await fetch(
			"https://bsky.social/xrpc/com.atproto.repo.createRecord",
			{
				method: "POST",
				headers: {
					Authorization: `Bearer ${session.accessJwt}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					repo: session.did,
					collection: "app.bsky.feed.post",
					record,
				}),
			},
		);

		if (!response.ok) {
			const body = await response.text();
			return {
				platform: "bluesky",
				success: false,
				error: `HTTP ${response.status}: ${body}`,
			};
		}

		const data = (await response.json()) as { uri: string };
		// Convert AT URI to web URL: at://did/app.bsky.feed.post/rkey -> https://bsky.app/profile/did/post/rkey
		const parts = data.uri.replace("at://", "").split("/");
		const postUrl = `https://bsky.app/profile/${parts[0]}/post/${parts[2]}`;

		return {
			platform: "bluesky",
			success: true,
			url: postUrl,
		};
	} catch (err) {
		return {
			platform: "bluesky",
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
