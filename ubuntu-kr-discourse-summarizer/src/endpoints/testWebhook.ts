import type { Context } from "hono";
import type { Env, DiscourseWebhookPayload } from "../types";
import { EXCLUDED_CATEGORY_IDS } from "../types";
import { summarize } from "../services/summarizer";
import { notifyDiscord } from "../services/discord";
import type { PlatformResult } from "../types";

const DISCOURSE_BASE_URL = "https://discourse.ubuntu-kr.org";

/**
 * Test endpoint — simulates a Discourse webhook without signature validation.
 *
 * Usage:
 *   curl -X POST https://<worker>/viral/test \
 *     -H "Content-Type: application/json" \
 *     -d '{"topic_id": 123, "title": "테스트 제목", "content": "테스트 내용입니다"}'
 *
 * Or provide a real Discourse topic ID to fetch its content:
 *   curl -X POST https://<worker>/viral/test \
 *     -H "Content-Type: application/json" \
 *     -d '{"topic_id": 456}'
 */
export async function handleTestWebhook(
	c: Context<{ Bindings: Env }>,
): Promise<Response> {
	const body = await c.req.json<{
		topic_id: number;
		title?: string;
		content?: string;
	}>();

	let title = body.title || "";
	let content = body.content || "";
	let slug = "test";
	let categoryId = 0;

	// If no title/content provided, fetch from Discourse
	if (!title || !content) {
		try {
			const res = await fetch(`${DISCOURSE_BASE_URL}/t/${body.topic_id}.json`);
			if (!res.ok) {
				return c.json({ success: false, error: `Failed to fetch topic: HTTP ${res.status}` }, 400);
			}
			const topicData = (await res.json()) as {
				title: string;
				slug: string;
				category_id: number;
				post_stream: { posts: Array<{ cooked: string }> };
			};
			title = title || topicData.title;
			content = content || topicData.post_stream.posts[0]?.cooked || "";
			slug = topicData.slug;
			categoryId = topicData.category_id;
		} catch (err) {
			return c.json({ success: false, error: `Failed to fetch topic: ${err}` }, 400);
		}
	}

	const topicUrl = `${DISCOURSE_BASE_URL}/t/${slug}/${body.topic_id}`;

	// Check excluded category
	if (EXCLUDED_CATEGORY_IDS.includes(categoryId)) {
		return c.json({ success: true, message: "Skipped: excluded category", categoryId });
	}

	// AI summarization
	const summary = await summarize(c.env, title, content);

	// Build post text with length check
	const urlLength = topicUrl.length;
	const maxSummaryLength = 280 - 2 - urlLength;
	let finalSummary = summary;
	if (finalSummary.length > maxSummaryLength) {
		const cut = finalSummary.slice(0, maxSummaryLength - 3);
		const lastSpace = cut.lastIndexOf(" ");
		finalSummary = (lastSpace > 50 ? cut.slice(0, lastSpace) : cut) + "...";
	}
	const postText = `${finalSummary}\n\n${topicUrl}`;

	// Only send Discord notification (no social posting, no D1 save)
	const allResults: PlatformResult[] = [
		{ platform: "twitter", success: false, error: "테스트 모드 — 발송 안 함" },
		{ platform: "mastodon", success: false, error: "테스트 모드 — 발송 안 함" },
		{ platform: "bluesky", success: false, error: "테스트 모드 — 발송 안 함" },
	];

	let discordSent = false;
	if (c.env.DISCORD_WEBHOOK_URL) {
		try {
			await notifyDiscord(c.env, finalSummary, topicUrl, `[TEST] ${title}`, allResults);
			discordSent = true;
		} catch (err) {
			return c.json({ success: false, error: `Discord notification failed: ${err}` }, 500);
		}
	}

	return c.json({
		success: true,
		mode: "test",
		summary,
		postText,
		postTextLength: postText.length,
		discordSent,
	});
}
