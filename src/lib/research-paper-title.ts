const GENERIC_TITLES = new Set([
	"title",
	"paper title",
	"research paper",
	"research paper title",
	"untitled",
]);

const SECTION_LABELS = new Set([
	"abstract",
	"keywords",
	"keywords:",
	"study area",
	"study area:",
	"introduction",
	"literature review",
	"methodology",
	"results / analysis",
	"results",
	"analysis",
	"discussion",
	"conclusion",
	"references",
]);

function cleanTitle(raw: string): string {
	return raw
		.replace(/\*\*/g, "")
		.replace(/\*/g, "")
		.replace(/\s+/g, " ")
		.trim();
}

function isUsableTitle(candidate: string): boolean {
	const text = cleanTitle(candidate);
	if (!text) return false;
	const key = text.toLowerCase().replace(/:$/, "").trim();
	if (GENERIC_TITLES.has(key)) return false;
	if (SECTION_LABELS.has(key)) return false;
	if (text.length < 12) return false;
	return true;
}

function tryBoldLine(line: string): string | null {
	const trimmed = line.trim();
	const boldOnly = trimmed.match(/^\*\*([^*\n]+)\*\*$/);
	if (boldOnly?.[1] && isUsableTitle(boldOnly[1])) return cleanTitle(boldOnly[1]);

	const leadingBold = trimmed.match(/^\*\*([^*]+)\*\*/);
	if (leadingBold?.[1] && isUsableTitle(leadingBold[1])) return cleanTitle(leadingBold[1]);

	return null;
}

export function extractPaperTitle(content: string, fallbackTopic: string): string {
	const trimmed = content.trim();
	if (!trimmed) return cleanTitle(fallbackTopic) || "Research paper";

	const hash = trimmed.match(/^#{1,6}\s+(.+)$/m);
	if (hash?.[1] && isUsableTitle(hash[1])) {
		return cleanTitle(hash[1]).slice(0, 220);
	}

	const lines = trimmed.split("\n").map((l) => l.trim());
	for (const line of lines.slice(0, 15)) {
		if (!line || line.startsWith("```")) continue;

		const fromBold = tryBoldLine(line);
		if (fromBold) return fromBold.slice(0, 220);

		if (!line.includes("**") && !line.startsWith("#") && isUsableTitle(line)) {
			return cleanTitle(line).slice(0, 220);
		}
	}

	const topic = cleanTitle(fallbackTopic);
	if (isUsableTitle(topic)) return topic.slice(0, 220);

	return topic.slice(0, 220) || "Research paper";
}

export function titleQuality(title: string): number {
	const text = cleanTitle(title);
	const key = text.toLowerCase();
	if (GENERIC_TITLES.has(key) || SECTION_LABELS.has(key)) return 0;
	return text.length;
}
