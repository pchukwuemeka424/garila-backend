export type CitePaper = {
	authors: string[];
	publicationDate: string | null;
	title: string;
	url: string;
	abstract?: string;
	topics?: string[];
};

const REFERENCE_STYLE_LINE = /^Reference style:\s*(.+)$/im;

export function parseCitationStyleLabel(text: string): string {
	const match = text.match(REFERENCE_STYLE_LINE);
	return match?.[1]?.trim() || "APA 7th edition";
}

export function isNumberedCitationStyle(styleLabel: string): boolean {
	const label = styleLabel.toLowerCase();
	return (
		/\bieee\b/.test(label) ||
		/\bvancouver\b/.test(label) ||
		/\bama\b/.test(label) ||
		/\bnature\b/.test(label) ||
		/\bscience\b/.test(label) ||
		/\bcell\b/.test(label) ||
		/\blancet\b/.test(label) ||
		/\bacs\b/.test(label) ||
		/citation[\s–-]*sequence/.test(label)
	);
}

const YEAR_TOKEN = /\b((?:19|20)\d{2})\b/;

export function extractYearToken(text: string | null | undefined): string | null {
	const match = text?.match(YEAR_TOKEN);
	return match?.[1] ?? null;
}

export function paperYear(
	publicationDate: string | null | undefined,
	...extras: Array<string | null | undefined>
): string {
	for (const text of [publicationDate, ...extras]) {
		const token = extractYearToken(text);
		if (token) return token;
		if (text?.trim()) {
			const parsed = new Date(text).getFullYear();
			if (Number.isFinite(parsed) && parsed >= 1800 && parsed <= 2100) return String(parsed);
		}
	}
	return "n.d.";
}

/** PubMed-style "Daneshjou R" / "Temsah MH" must not treat the initial as the family name. */
const INITIALS_TOKEN = /^(?:[A-Z](?:[.\s-]*[A-Z]){0,3}\.?|[A-Z]{1,4})$/;

export function parseAuthorName(raw: string): { family: string; given: string } {
	const trimmed = raw
		.trim()
		.replace(/\s+/g, " ")
		.replace(/\bsource[:.]?\s*/gi, " ")
		.trim();
	if (!trimmed) return { family: "", given: "" };

	if (trimmed.includes(",")) {
		const [family, ...rest] = trimmed.split(",");
		return { family: family!.trim(), given: rest.join(",").trim() };
	}

	const parts = trimmed.split(/\s+/);
	if (parts.length === 1) return { family: parts[0]!, given: "" };

	const last = parts[parts.length - 1]!;
	const lastBare = last.replace(/[.]/g, "");
	if (INITIALS_TOKEN.test(lastBare) || (lastBare.length <= 2 && /^[A-Za-z]+$/.test(lastBare))) {
		return { family: parts[0]!, given: parts.slice(1).join(" ") };
	}

	return {
		family: last.replace(/[.,]/g, ""),
		given: parts.slice(0, -1).join(" "),
	};
}

export function paperFamilyNames(authors: string[]): string[] {
	return authors.map((author) => parseAuthorName(author).family).filter(Boolean);
}

function initialsFromGiven(given: string): string {
	return given
		.split(/[\s.]+/)
		.filter(Boolean)
		.map((part) => `${part[0]!.toUpperCase()}.`)
		.join(" ");
}

export function formatAuthorLine(authors: string[], max = 20): string {
	if (authors.length === 0) return "Authors unavailable";
	const formatted = authors.map((raw) => {
		const { family, given } = parseAuthorName(raw);
		if (!family) return raw.trim();
		const initials = initialsFromGiven(given);
		return initials ? `${family}, ${initials}` : family;
	});
	if (formatted.length === 1) return formatted[0]!;
	if (authors.length > max) {
		const last = formatted[formatted.length - 1]!;
		return `${formatted.slice(0, 19).join(", ")}, ... ${last}`;
	}
	const last = formatted.pop()!;
	if (formatted.length === 0) return last;
	return `${formatted.join(", ")}, & ${last}`;
}

export function cleanReferenceTitle(title: string): string {
	return title
		.replace(/\bsource[:.]?\s*/gi, " ")
		.replace(/\barXiv:?\s*\d{4}\.\d{4,5}(?:v\d+)?/gi, " ")
		.replace(/\s{2,}/g, " ")
		.replace(/^[\s.:-]+/, "")
		.trim();
}

export function citeYear(paper: CitePaper): string {
	return paperYear(paper.publicationDate, paper.title, paper.url);
}

export function paperIsCitable(paper: CitePaper): boolean {
	return paperFamilyNames(paper.authors).length > 0 && citeYear(paper) !== "n.d." && Boolean(cleanReferenceTitle(paper.title));
}

export function formatParentheticalCite(paper: CitePaper, index: number, numbered: boolean): string {
	if (numbered) return `[${index + 1}]`;
	const names = paperFamilyNames(paper.authors);
	const year = citeYear(paper);
	if (names.length === 0) return `(Unknown, ${year})`;
	if (names.length === 1) return `(${names[0]}, ${year})`;
	if (names.length === 2) return `(${names[0]} & ${names[1]}, ${year})`;
	return `(${names[0]} et al., ${year})`;
}

export function formatNarrativeCite(paper: CitePaper, index: number, numbered: boolean): string {
	if (numbered) return `[${index + 1}]`;
	const names = paperFamilyNames(paper.authors);
	const year = citeYear(paper);
	if (names.length === 0) return `Unknown (${year})`;
	if (names.length === 1) return `${names[0]} (${year})`;
	if (names.length === 2) return `${names[0]} and ${names[1]} (${year})`;
	return `${names[0]} et al. (${year})`;
}

export function paperCiteKey(paper: CitePaper): string {
	const family = (paperFamilyNames(paper.authors)[0] ?? "unknown").toLowerCase();
	return `${family}|${citeYear(paper)}`;
}

/** APA 7 reference: Author, A. A., & Author, B. B. (Year). Title. Venue. URL */
export function formatApa7Reference(paper: CitePaper): string {
	const authorLine = formatAuthorLine(paper.authors);
	const year = citeYear(paper);
	const title = cleanReferenceTitle(paper.title.replace(/\*/g, "").replace(/\]/g, ""));
	const venue = (paper.topics ?? []).find((topic) =>
		/\b(journal|review|quarterly|proceedings|annals)\b/i.test(topic),
	);
	const url = paper.url?.trim() ?? "";
	const parts = [
		`${authorLine} (${year}).`,
		`${title}.`,
		venue ? `*${venue.trim()}*.` : "",
		url,
	].filter(Boolean);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}
