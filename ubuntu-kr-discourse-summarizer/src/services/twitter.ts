import type { Env } from "../types";
import type { PlatformResult } from "../types";

function percentEncode(str: string): string {
	return encodeURIComponent(str).replace(
		/[!'()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
	);
}

function generateNonce(): string {
	const array = new Uint8Array(16);
	crypto.getRandomValues(array);
	return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

async function hmacSha1Sign(key: string, data: string): Promise<string> {
	const encoder = new TextEncoder();
	const cryptoKey = await crypto.subtle.importKey(
		"raw",
		encoder.encode(key),
		{ name: "HMAC", hash: "SHA-1" },
		false,
		["sign"],
	);
	const signature = await crypto.subtle.sign(
		"HMAC",
		cryptoKey,
		encoder.encode(data),
	);
	return btoa(String.fromCharCode(...new Uint8Array(signature)));
}

async function buildOAuthHeader(
	method: string,
	url: string,
	env: Env,
): Promise<string> {
	const oauthParams: Record<string, string> = {
		oauth_consumer_key: env.TWITTER_API_KEY,
		oauth_nonce: generateNonce(),
		oauth_signature_method: "HMAC-SHA1",
		oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
		oauth_token: env.TWITTER_ACCESS_TOKEN,
		oauth_version: "1.0",
	};

	const paramString = Object.keys(oauthParams)
		.sort()
		.map((k) => `${percentEncode(k)}=${percentEncode(oauthParams[k])}`)
		.join("&");

	const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
	const signingKey = `${percentEncode(env.TWITTER_API_SECRET)}&${percentEncode(env.TWITTER_ACCESS_SECRET)}`;

	oauthParams.oauth_signature = await hmacSha1Sign(signingKey, baseString);

	const header = Object.keys(oauthParams)
		.sort()
		.map((k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`)
		.join(", ");

	return `OAuth ${header}`;
}

export async function postToTwitter(
	env: Env,
	text: string,
): Promise<PlatformResult> {
	try {
		const url = "https://api.twitter.com/2/tweets";
		const authorization = await buildOAuthHeader("POST", url, env);

		const response = await fetch(url, {
			method: "POST",
			headers: {
				Authorization: authorization,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ text }),
		});

		if (!response.ok) {
			const body = await response.text();
			return {
				platform: "twitter",
				success: false,
				error: `HTTP ${response.status}: ${body}`,
			};
		}

		const data = (await response.json()) as { data: { id: string } };
		return {
			platform: "twitter",
			success: true,
			url: `https://x.com/i/web/status/${data.data.id}`,
		};
	} catch (err) {
		return {
			platform: "twitter",
			success: false,
			error: err instanceof Error ? err.message : String(err),
		};
	}
}
