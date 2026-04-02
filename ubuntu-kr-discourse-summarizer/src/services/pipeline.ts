import type { Env, PlatformResult } from "../types";
import { EXCLUDED_CATEGORY_IDS, EXCLUDED_CATEGORY_SLUGS } from "../types";
import { summarize } from "./summarizer";
import { postToTwitter } from "./twitter";
import { postToMastodon } from "./mastodon";
import { postToBluesky } from "./bluesky";
import { notifyDiscord } from "./discord";

const DISCOURSE_BASE_URL = "https://discourse.ubuntu-kr.org";

export interface PipelineInput {
	topicId: number;
	topicTitle: string;
	topicSlug: string;
	topicContent: string;
	categoryId: number;
	categorySlug?: string;
	postsCount?: number;
}

export interface PipelineResult {
	success: boolean;
	message?: string;
	title?: string;
	summary?: string;
	postText?: string;
	platforms?: Array<{ platform: string; success: boolean; url?: string; error?: string }>;
	mode?: string;
}

export async function runPipeline(
	env: Env,
	input: PipelineInput,
	testMode: boolean,
): Promise<PipelineResult> {
	const topicUrl = `${DISCOURSE_BASE_URL}/t/${input.topicSlug}/${input.topicId}`;

	// Skip replies (only process the first post in a topic)
	if (input.postsCount !== undefined && input.postsCount > 1) {
		return { success: true, message: "Skipped: reply, not a new topic" };
	}

	// Skip excluded categories
	if (EXCLUDED_CATEGORY_IDS.includes(input.categoryId)) {
		return { success: true, message: "Skipped: excluded category (by ID)" };
	}
	if (input.categorySlug && EXCLUDED_CATEGORY_SLUGS.includes(input.categorySlug)) {
		return { success: true, message: "Skipped: excluded category (by slug)" };
	}

	// Skip admin-only (read_restricted) categories
	try {
		const catRes = await fetch(`${DISCOURSE_BASE_URL}/c/${input.categoryId}/show.json`);
		if (catRes.ok) {
			const catData = (await catRes.json()) as { category?: { read_restricted?: boolean } };
			if (catData.category?.read_restricted) {
				return { success: true, message: "Skipped: restricted category" };
			}
		}
	} catch {
		// proceed if API fails
	}

	// Dedup check
	const existing = await env.DB.prepare("SELECT id FROM posts WHERE topic_id = ?")
		.bind(input.topicId)
		.first();
	if (existing) {
		return { success: true, message: "Already processed" };
	}

	// AI summarization
	const summary = await summarize(env, input.topicTitle, input.topicContent);

	// Fit within Twitter's 280-char limit
	const urlLength = topicUrl.length;
	const maxSummaryLength = 280 - 2 - urlLength;
	let finalSummary = summary;
	if (finalSummary.length > maxSummaryLength) {
		const cut = finalSummary.slice(0, maxSummaryLength - 3);
		const lastSpace = cut.lastIndexOf(" ");
		finalSummary = (lastSpace > 50 ? cut.slice(0, lastSpace) : cut) + "...";
	}
	const postText = `${finalSummary}\n\n${topicUrl}`;

	// Platform posting
	let allResults: PlatformResult[];

	if (testMode) {
		allResults = [
			{ platform: "twitter", success: false, error: "테스트 모드 — 발송 안 함" },
			{ platform: "mastodon", success: false, error: "테스트 모드 — 발송 안 함" },
			{ platform: "bluesky", success: false, error: "테스트 모드 — 발송 안 함" },
		];
	} else {
		const hasTwitter = env.TWITTER_API_KEY && env.TWITTER_API_SECRET && env.TWITTER_ACCESS_TOKEN && env.TWITTER_ACCESS_SECRET;
		const hasMastodon = env.MASTODON_INSTANCE_URL && env.MASTODON_ACCESS_TOKEN;
		const hasBluesky = env.BLUESKY_HANDLE && env.BLUESKY_APP_PASSWORD;

		const platformPromises: Promise<PlatformResult>[] = [];
		if (hasTwitter) platformPromises.push(postToTwitter(env, postText));
		if (hasMastodon) platformPromises.push(postToMastodon(env, postText));
		if (hasBluesky) platformPromises.push(postToBluesky(env, postText));

		const settled = await Promise.allSettled(platformPromises);
		const postedResults = settled.map((r): PlatformResult =>
			r.status === "fulfilled"
				? r.value
				: { platform: "unknown", success: false, error: r.reason instanceof Error ? r.reason.message : String(r.reason) },
		);

		allResults = [
			hasTwitter ? postedResults.find((r) => r.platform === "twitter")! : { platform: "twitter", success: false, error: "발송 안 함 (env 없음)" },
			hasMastodon ? postedResults.find((r) => r.platform === "mastodon")! : { platform: "mastodon", success: false, error: "발송 안 함 (env 없음)" },
			hasBluesky ? postedResults.find((r) => r.platform === "bluesky")! : { platform: "bluesky", success: false, error: "발송 안 함 (env 없음)" },
		];
	}

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
			input.topicId,
			input.topicTitle,
			topicUrl,
			summary,
			twitterUrl,
			mastodonUrl,
			blueskyUrl,
			errors.length > 0 ? JSON.stringify(errors) : null,
		)
		.run();

	// Discord notification
	const discordTitle = testMode ? `[TEST] ${input.topicTitle}` : input.topicTitle;
	try {
		await notifyDiscord(env, summary, topicUrl, discordTitle, allResults);
		await env.DB.prepare("UPDATE posts SET discord_notified = 1 WHERE topic_id = ?")
			.bind(input.topicId)
			.run();
	} catch (err) {
		console.error("Discord notification failed:", err);
	}

	return {
		success: true,
		title: input.topicTitle,
		summary,
		postText,
		mode: testMode ? "test" : "live",
		platforms: allResults.map((r) => ({
			platform: r.platform,
			success: r.success,
			url: r.url,
			error: r.error,
		})),
	};
}
