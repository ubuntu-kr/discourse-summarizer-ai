import type { Env, PlatformResult } from "../types";

export async function postToMastodon(
	env: Env,
	text: string,
): Promise<PlatformResult> {
	try {
		const url = `${env.MASTODON_INSTANCE_URL}/api/v1/statuses`;

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: `Bearer ${env.MASTODON_ACCESS_TOKEN}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				status: text,
				visibility: "public",
			}),
		});

		if (!response.ok) {
			const body = await response.text();
			return {
				platform: "mastodon",
				success: false,
				error: `HTTP ${response.status}: ${body}`,
			};
		}

		const data = (await response.json()) as { url: string };
		return {
			platform: "mastodon",
			success: true,
			url: data.url,
		};
	} catch (err) {
		return {
			platform: "mastodon",
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
