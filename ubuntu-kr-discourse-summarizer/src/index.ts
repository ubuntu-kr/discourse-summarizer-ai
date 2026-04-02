import { Hono } from "hono";
import type { Env } from "./types";
import { handleDiscourseWebhook } from "./endpoints/discourseWebhook";
import { handleTestWebhook } from "./endpoints/testWebhook";
import { handlePostList } from "./endpoints/postList";

const app = new Hono<{ Bindings: Env }>();

// Webhook endpoint for Discourse
app.post("/webhook/discourse/viral", handleDiscourseWebhook);

// Test endpoint — send a fake webhook without signature validation
// app.post("/webhook/discourse/viral/test", handleTestWebhook);

// Post history API
app.get("/api/posts/viral", handlePostList);

// Health check
app.get("/", (c) => c.json({ status: "ok", service: "ubuntu-kr-discourse-summarizer" }));

export default app;
