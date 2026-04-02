import { z } from "zod";

export interface Env {
	DB: D1Database;
	AI: Ai;
	DISCOURSE_WEBHOOK_SECRET: string;
	TWITTER_API_KEY: string;
	TWITTER_API_SECRET: string;
	TWITTER_ACCESS_TOKEN: string;
	TWITTER_ACCESS_SECRET: string;
	MASTODON_INSTANCE_URL: string;
	MASTODON_ACCESS_TOKEN: string;
	BLUESKY_HANDLE: string;
	BLUESKY_APP_PASSWORD: string;
	DISCORD_WEBHOOK_URL: string;
}

export interface DiscourseWebhookPayload {
	topic: {
		id: number;
		title: string;
		slug: string;
		excerpt: string;
		cooked: string;
		posts_count: number;
		created_at: string;
		tags: string[];
		category_id: number;
		category_slug?: string;
	};
}

// Categories to skip (won't be posted to social media)
export const EXCLUDED_CATEGORY_SLUGS = [
	"구인구직홍보", // 구인/구직/홍보
];
export const EXCLUDED_CATEGORY_IDS: number[] = [
	37, // 구인/구직/홍보 (promo)
];

export interface PostRecord {
	id: number;
	topic_id: number;
	topic_title: string;
	topic_url: string;
	summary: string;
	twitter_url: string | null;
	mastodon_url: string | null;
	bluesky_url: string | null;
	discord_notified: number;
	created_at: string;
	errors: string | null;
}

export interface PlatformResult {
	platform: string;
	success: boolean;
	url?: string;
	error?: string;
}

export const PostSchema = z.object({
	id: z.number(),
	topic_id: z.number(),
	topic_title: z.string(),
	topic_url: z.string(),
	summary: z.string(),
	twitter_url: z.string().nullable(),
	mastodon_url: z.string().nullable(),
	bluesky_url: z.string().nullable(),
	discord_notified: z.number(),
	created_at: z.string(),
	errors: z.string().nullable(),
});
