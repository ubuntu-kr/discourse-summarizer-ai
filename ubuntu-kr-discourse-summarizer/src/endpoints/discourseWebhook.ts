import type { Context } from "hono";
import type { Env, DiscourseWebhookPayload } from "../types";
import { runPipeline } from "../services/pipeline";

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

	const result = await runPipeline(env, {
		topicId: topic.id,
		topicTitle: topic.title,
		topicSlug: topic.slug,
		topicContent: topic.cooked || topic.excerpt || topic.title,
		categoryId: topic.category_id,
		categorySlug: topic.category_slug,
	}, false);

	return c.json(result);
}
