import type { Context } from "hono";
import type { Env } from "../types";
import { runPipeline } from "../services/pipeline";

const DISCOURSE_BASE_URL = "https://discourse.ubuntu-kr.org";

/**
 * Test endpoint — same pipeline as the real webhook but:
 * - No signature validation
 * - SNS posting skipped (Discord only)
 * - Can fetch topic content from Discourse by topic_id
 *
 * Usage:
 *   curl -X POST https://<worker>/webhook/discourse/viral/test \
 *     -H "Content-Type: application/json" \
 *     -d '{"topic_id": 123}'
 *
 *   curl -X POST https://<worker>/webhook/discourse/viral/test \
 *     -H "Content-Type: application/json" \
 *     -d '{"topic_id": 1, "title": "테스트 제목", "content": "테스트 내용"}'
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

	const result = await runPipeline(c.env, {
		topicId: body.topic_id,
		topicTitle: title,
		topicSlug: slug,
		topicContent: content,
		categoryId,
	}, true);

	return c.json(result);
}
