import type { Env } from "../types";

function stripHtml(html: string): string {
	return html
		.replace(/<[^>]*>/g, "")
		.replace(/&nbsp;/g, " ")
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/\s+/g, " ")
		.trim();
}

export interface SummarizeResult {
	title: string;
	body: string;
}

export async function summarize(
	env: Env,
	title: string,
	rawContent: string,
): Promise<SummarizeResult> {
	const content = stripHtml(rawContent).slice(0, 2000);

	const response = await env.AI.run(
		"@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		{
			messages: [
				{
					role: "system",
					content: `당신은 Ubuntu Korea 커뮤니티의 소셜 미디어 매니저입니다.
다음 Discourse 게시글을 소셜 미디어용으로 작성해주세요.

제목 스타일:
- 원래 제목의 핵심 의미를 유지하되, 살짝 궁금증/흥미를 자극하는 톤으로
- 과장하지 말고 쪼끔만 바꾸기 (예: "Ubuntu 24.04 출시" → "Ubuntu 24.04 드디어 나왔다!")
- 최대 50자

본문 스타일:
- 게시글의 핵심 내용(무엇이, 왜 중요한지)을 충실히 전달하면서, 읽는 사람이 "이거 나도 알아야 하는데?" 하고 클릭하게 만드는 톤으로 작성
- 단순 요약이 아니라, 핵심 포인트를 짚어주면서 궁금증을 유발하는 한 줄을 섞어주세요
- 최대 200자

규칙:
- 한국어로 작성
- 본문에 적절한 이모지 1-2개 사용
- 본문에 해시태그 1-2개 포함 (#Ubuntu #우분투한국커뮤니티 등)
- URL은 포함하지 마세요 (별도로 추가됩니다)`,
				},
				{
					role: "user",
					content: `제목: ${title}\n내용: ${content}`,
				},
			],
			response_format: {
				type: "json_schema",
				json_schema: {
					type: "object",
					properties: {
						title: {
							type: "string",
							description: "바이럴 제목 (최대 50자)",
						},
						body: {
							type: "string",
							description: "소셜 미디어 포스트 본문 (최대 200자)",
						},
					},
					required: ["title", "body"],
				},
			},
		} as Record<string, unknown>,
	);

	// JSON mode returns parsed object directly in response field
	try {
		let parsed: { title?: string; body?: string };
		if (typeof response === "object" && response !== null && "response" in response) {
			const inner = (response as { response: unknown }).response;
			if (typeof inner === "object" && inner !== null) {
				parsed = inner as { title?: string; body?: string };
			} else {
				parsed = JSON.parse(String(inner));
			}
		} else {
			parsed = JSON.parse(String(response));
		}
		return {
			title: trimText(parsed.title || title, 50),
			body: trimText(parsed.body || title, 200),
		};
	} catch {
		// Fallback if JSON parsing fails
		const text =
			typeof response === "object" && response !== null && "response" in response
				? String((response as { response: unknown }).response)
				: String(response);
		return {
			title,
			body: trimText((text || "").trim(), 200),
		};
	}
}

function trimText(text: string, maxLength: number): string {
	const trimmed = text.trim();
	if (trimmed.length <= maxLength) return trimmed;

	const cut = trimmed.slice(0, maxLength - 3);
	const lastSpace = cut.lastIndexOf(" ");
	return (lastSpace > 50 ? cut.slice(0, lastSpace) : cut) + "...";
}
