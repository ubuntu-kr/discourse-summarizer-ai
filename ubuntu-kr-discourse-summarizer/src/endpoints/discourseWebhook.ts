import type { Context } from "hono";
import type { Env, DiscourseWebhookPayload, PlatformResult } from "../types";
import { EXCLUDED_CATEGORY_SLUGS, EXCLUDED_CATEGORY_IDS } from "../types";
import { summarize } from "../services/summarizer";
import { postToTwitter } from "../services/twitter";
import { postToMastodon } from "../services/mastodon";
import { postToBluesky } from "../services/bluesky";
import { notifyDiscord } from "../services/discord";

const DISCOURSE_BASE_URL = "https://discourse.ubuntu-kr.org";

async function verifySignature(
	secret: string,
	body: string,
	signature: string,
): Promise<boolean> {
	const encoder = new TextEncoder();
	const key = await crypto.subtle.importKey(
		"raw",
		encoder.encode(secret),
		{ name: "HMAC", hash: "SHA-256" },
		false,
		["sign"],
	);
	const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(body));
	const computed =
		"sha256=" +
		Array.from(new Uint8Array(sig))
			.map((b) => b.toString(16).padStart(2, "0"))
			.join("");

	return computed === signature;
}

export async function handleDiscourseWebhook(
	c: Context<{ Bindings: Env }>,
): Promise<Response> {
	const env = c.env;

	// Validate signature
	const signature = c.req.header("X-Discourse-Event-Signature");
	if (!signature) {
		return c.json({ success: false, error: "Missing signature" }, 403);
	}

	const rawBody = await c.req.text();

	const valid = await verifySignature(
		env.DISCOURSE_WEBHOOK_SECRET,
		rawBody,
		signature,
	);
	if (!valid) {
		return c.json({ success: false, error: "Invalid signature" }, 403);
	}

	// Check event type
	const eventType = c.req.header("X-Discourse-Event");
	if (eventType !== "topic_created") {
		return c.json({ success: true, message: `Ignored event: ${eventType}` });
	}

	// Parse payload
	const payload = JSON.parse(rawBody) as DiscourseWebhookPayload;
	const topic = payload.topic;
	const topicUrl = `${DISCOURSE_BASE_URL}/t/${topic.slug}/${topic.id}`;

	// Skip excluded categories (e.g. 구인/구직/홍보)
	if (EXCLUDED_CATEGORY_IDS.includes(topic.category_id)) {
		return c.json({ success: true, message: "Skipped: excluded category (by ID)" });
	}
	if (topic.category_slug && EXCLUDED_CATEGORY_SLUGS.includes(topic.category_slug)) {
		return c.json({ success: true, message: "Skipped: excluded category (by slug)" });
	}

	// Skip admin-only (read_restricted) categories via Discourse API
	try {
		const catRes = await fetch(`${DISCOURSE_BASE_URL}/c/${topic.category_id}/show.json`);
		if (catRes.ok) {
			const catData = (await catRes.json()) as { category?: { read_restricted?: boolean } };
			if (catData.category?.read_restricted) {
				return c.json({ success: true, message: "Skipped: restricted category" });
			}
		}
	} catch {
		// If API fails, proceed anyway — don't block posting on a lookup failure
	}

	// Dedup check
	const existing = await env.DB.prepare(
		"SELECT id FROM posts WHERE topic_id = ?",
	)
		.bind(topic.id)
		.first();

	if (existing) {
		return c.json({ success: true, message: "Already processed" });
	}

	// AI summarization
	const content = topic.cooked || topic.excerpt || topic.title;
	const summary = await summarize(env, topic.title, content);

	// Ensure total post text fits within Twitter's 280-char limit
	// Twitter counts URLs as 23 chars (t.co wrapping), but other platforms don't
	// Reserve space for "\n\n" (2 chars) + URL
	const urlLength = topicUrl.length;
	const maxSummaryLength = 280 - 2 - urlLength; // 2 for "\n\n"
	let finalSummary = summary;
	if (finalSummary.length > maxSummaryLength) {
		const cut = finalSummary.slice(0, maxSummaryLength - 3);
		const lastSpace = cut.lastIndexOf(" ");
		finalSummary = (lastSpace > 50 ? cut.slice(0, lastSpace) : cut) + "...";
	}
	const postText = `${finalSummary}\n\n${topicUrl}`;

	// Post to platforms only if their env vars are configured
	const hasTwitter = env.TWITTER_API_KEY && env.TWITTER_API_SECRET && env.TWITTER_ACCESS_TOKEN && env.TWITTER_ACCESS_SECRET;
	const hasMastodon = env.MASTODON_INSTANCE_URL && env.MASTODON_ACCESS_TOKEN;
	const hasBluesky = env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD;

	const platformPromises: Promise<PlatformResult>[] = [];

	if (hasTwitter) {
		platformPromises.push(postToTwitter(env, postText));
	}
	if (hasMastodon) {
		platformPromises.push(postToMastodon(env, postText));
	}
	if (hasBluesky) {
		platformPromises.push(postToBluesky(env, postText));
	}

	const settled = await Promise.allSettled(platformPromises);
	const postedResults = settled.map((r): PlatformResult =>
		r.status === "fulfilled"
			? r.value
			: { platform: "unknown", success: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
	);

	// Add "not configured" entries for missing platforms
	const allResults: PlatformResult[] = [
		hasTwitter ? postedResults.find((r) => r.platform === "twitter")! : { platform: "twitter", success: false, error: "발송 안 함 (env 없음)" },
		hasMastodon ? postedResults.find((r) => r.platform === "mastodon")! : { platform: "mastodon", success: false, error: "발송 안 함 (env 없음)" },
		hasBluesky ? postedResults.find((r) => r.platform === "bluesky")! : { platform: "bluesky", success: false, error: "발송 안 함 (env 없음)" },
	];

	// Collect errors
	const errors = allResults
		.filter((r) => !r.success)
		.map((r) => ({ platform: r.platform, error: r.error }));

	// Save to D1
	const twitterUrl = allResults.find((r) => r.platform === "twitter")?.url || null;
	const mastodonUrl = allResults.find((r) => r.platform === "mastodon")?.url || null;
	const blueskyUrl = allResults.find((r) => r.platform === "bluesky")?.url || null;

	await env.DB.prepare(
		`INSERT INTO posts (topic_id, topic_title, topic_url, summary, twitter_url, mastodon_url, bluesky_url, discord_notified, errors)
		 VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
	)
		.bind(
			topic.id,
			topic.title,
			topicUrl,
			summary,
			twitterUrl,
			mastodonUrl,
			blueskyUrl,
			errors.length > 0 ? JSON.stringify(errors) : null,
		)
		.run();

	// Discord notification
	try {
		await notifyDiscord(env, summary, topicUrl, topic.title, allResults);
		await env.DB.prepare(
			"UPDATE posts SET discord_notified = 1 WHERE topic_id = ?",
		)
			.bind(topic.id)
			.run();
	} catch (err) {
		console.error("Discord notification failed:", err);
	}

	return c.json({
		success: true,
		summary,
		postText,
		platforms: allResults.map((r) => ({
			platform: r.platform,
			success: r.success,
			url: r.url,
			error: r.error,
		})),
	});
}
