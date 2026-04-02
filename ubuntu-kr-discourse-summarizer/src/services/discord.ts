import type { Env, PlatformResult } from "../types";

export async function notifyDiscord(
	env: Env,
	summary: string,
	topicUrl: string,
	topicTitle: string,
	results: PlatformResult[],
): Promise<void> {
	const fields = results.map((r) => ({
		name: r.platform.charAt(0).toUpperCase() + r.platform.slice(1),
		value: r.success ? `[View post](${r.url})` : `Failed: ${r.error}`,
		inline: true,
	}));

	const allSucceeded = results.every((r) => r.success);
	const color = allSucceeded ? 3066993 : 15105570; // green or orange

	const payload = {
		embeds: [
			{
				title: `📢 ${topicTitle}`,
				description: summary,
				url: topicUrl,
				color,
				fields,
				footer: { text: "Ubuntu Korea Community" },
				timestamp: new Date().toISOString(),
			},
		],
	};

	await fetch(env.DISCORD_WEBHOOK_URL, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
}
