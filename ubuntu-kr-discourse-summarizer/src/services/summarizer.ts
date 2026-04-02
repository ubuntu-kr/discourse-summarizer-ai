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

export async function summarize(
	env: Env,
	title: string,
	rawContent: string,
): Promise<string> {
	const content = stripHtml(rawContent).slice(0, 2000);

	const response = await env.AI.run(
		"@cf/meta/llama-3.3-70b-instruct-fp8-fast",
		{
			messages: [
				{
					role: "system",
					content: `당신은 Ubuntu Korea 커뮤니티의 소셜 미디어 매니저입니다.
다음 Discourse 게시글을 소셜 미디어용 포스트 본문으로 작성해주세요.

본문 스타일:
- 게시글의 핵심 내용(무엇이, 왜 중요한지)을 충실히 전달하면서, 읽는 사람이 "이거 나도 알아야 하는데?" 하고 클릭하게 만드는 톤으로 작성
- 단순 요약이 아니라, 핵심 포인트를 짚어주면서 궁금증을 유발하는 한 줄을 섞어주세요
- 친구한테 카톡으로 공유할 때 쓰는 톤으로! 격식 없이, 가볍고 재밌게
- 최대 200자

규칙:
- 한국어로 작성
- 적절한 이모지 1-2개 사용
- 해시태그 1-2개 포함 (#Ubuntu #우분투한국커뮤니티 등)
- URL은 포함하지 마세요 (별도로 추가됩니다)
- 포스트 본문만 출력하세요, 다른 설명은 하지 마세요`,
				},
				{
					role: "user",
					content: `제목: ${title}\n내용: ${content}`,
				},
			],
			max_tokens: 1024,
		},
	);

	const text =
		typeof response === "object" && response !== null && "response" in response
			? (response as { response: string }).response
			: String(response);

	const trimmed = (text || "").trim();
	if (trimmed.length <= 200) return trimmed;

	const cut = trimmed.slice(0, 197);
	const lastSpace = cut.lastIndexOf(" ");
	return (lastSpace > 50 ? cut.slice(0, lastSpace) : cut) + "...";
}
