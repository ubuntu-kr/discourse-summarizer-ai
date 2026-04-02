import type { Context } from "hono";
import type { Env } from "../types";

export async function handlePostList(
	c: Context<{ Bindings: Env }>,
): Promise<Response> {
	const page = Number(c.req.query("page") || "1");
	const limit = 20;
	const offset = (page - 1) * limit;

	const results = await c.env.DB.prepare(
		"SELECT * FROM posts ORDER BY created_at DESC LIMIT ? OFFSET ?",
	)
		.bind(limit, offset)
		.all();

	return c.json({
		success: true,
		result: {
			posts: results.results,
			page,
		},
	});
}
