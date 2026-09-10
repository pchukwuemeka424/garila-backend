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

export type CitationStyleFamily =
	| "numbered" // IEEE, Vancouver, AMA, Nature, Science, Cell, Lancet, ACS, CSE-seq, Chicago notes, Legal
	| "author-date" // APA, Harvard, Chicago author-date, ASA, APSA, CSE name-year, Springer, Elsevier, DIN
	| "mla" // MLA 9, MLA 8
	| "abnt" // ABNT
	| "bibtex"; // BibTeX

export function getCitationStyleFamily(styleLabelOrId: string): CitationStyleFamily {
	const label = (styleLabelOrId || "").toLowerCase().trim();
	if (!label) return "author-date";

	if (
		/\bieee\b/.test(label) ||
		/\bvancouver\b/.test(label) ||
		/\bama\b/.test(label) ||
		/\bnature\b/.test(label) ||
		/\bscience\b/.test(label) ||
		/\bcell\b/.test(label) ||
		/\blancet\b/.test(label) ||
		/\bacs\b/.test(label) ||
		/citation[\s–-]*sequence/.test(label) ||
		/chicago.*(?:notes|bibliography)/.test(label) ||
		/\bturabian\b/.test(label) && /notes/.test(label) ||
		/\boscola\b/.test(label) ||
		/\bbluebook\b/.test(label) ||
		/\baglc\b/.test(label)
	) {
		return "numbered";
	}

	if (/\bmla\b/.test(label)) {
		return "mla";
	}

	if (/\babnt\b/.test(label)) {
		return "abnt";
	}

	if (/\bbibtex\b/.test(label)) {
		return "bibtex";
	}

	return "author-date";
}

export function isNumberedCitationStyle(styleLabelOrId: string): boolean {
	return getCitationStyleFamily(styleLabelOrId) === "numbered";
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
	if (INITIALS_TOKEN.test(lastBare)) {
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

function initialsFromGiven(given: string, withDots = true): string {
	const parts = given
		.split(/[\s.]+/)
		.filter(Boolean)
		.map((part) => (withDots ? `${part[0]!.toUpperCase()}.` : part[0]!.toUpperCase()));
	return withDots ? parts.join(" ") : parts.join("");
}

export function formatAuthorLine(authors: string[], max = 20): string {
	if (authors.length === 0) return "Authors unavailable";
	const formatted = authors.map((raw) => {
		const { family, given } = parseAuthorName(raw);
		if (!family) return raw.trim();
		const initials = initialsFromGiven(given, true);
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

export function formatParentheticalCite(
	paper: CitePaper,
	index: number,
	styleOrNumbered: string | boolean = false,
): string {
	const isNumbered =
		typeof styleOrNumbered === "boolean"
			? styleOrNumbered
			: isNumberedCitationStyle(styleOrNumbered);
	if (isNumbered) return `[${index + 1}]`;

	const family = typeof styleOrNumbered === "string" ? getCitationStyleFamily(styleOrNumbered) : "author-date";
	const names = paperFamilyNames(paper.authors);
	const year = citeYear(paper);
	const styleLower = (typeof styleOrNumbered === "string" ? styleOrNumbered : "").toLowerCase();

	if (family === "mla") {
		if (names.length === 0) return `(Unknown)`;
		if (names.length === 1) return `(${names[0]})`;
		if (names.length === 2) return `(${names[0]} and ${names[1]})`;
		return `(${names[0]} et al.)`;
	}

	if (family === "abnt") {
		const upperNames = names.map((n) => n.toUpperCase());
		if (upperNames.length === 0) return `(UNKNOWN, ${year})`;
		if (upperNames.length === 1) return `(${upperNames[0]}, ${year})`;
		if (upperNames.length === 2) return `(${upperNames[0]}; ${upperNames[1]}, ${year})`;
		return `(${upperNames[0]} et al., ${year})`;
	}

	const isNoComma =
		/chicago.*author/i.test(styleLower) ||
		/\basa\b/i.test(styleLower) ||
		/\bapsa\b/i.test(styleLower) ||
		/cse.*(?:name|year)/i.test(styleLower);

	const isAndWord =
		/\bharvard\b/i.test(styleLower) ||
		/\boxford\b/i.test(styleLower) ||
		/\belsevier\b/i.test(styleLower) ||
		isNoComma;

	const sep = isNoComma ? " " : ", ";
	const andChar = isAndWord ? " and " : " & ";

	if (names.length === 0) return `(Unknown${sep}${year})`;
	if (names.length === 1) return `(${names[0]}${sep}${year})`;
	if (names.length === 2) return `(${names[0]}${andChar}${names[1]}${sep}${year})`;
	return `(${names[0]} et al.${sep}${year})`;
}

export function formatNarrativeCite(
	paper: CitePaper,
	index: number,
	styleOrNumbered: string | boolean = false,
): string {
	const isNumbered =
		typeof styleOrNumbered === "boolean"
			? styleOrNumbered
			: isNumberedCitationStyle(styleOrNumbered);
	if (isNumbered) return `[${index + 1}]`;

	const family = typeof styleOrNumbered === "string" ? getCitationStyleFamily(styleOrNumbered) : "author-date";
	const names = paperFamilyNames(paper.authors);
	const year = citeYear(paper);

	if (family === "mla") {
		if (names.length === 0) return `Unknown`;
		if (names.length === 1) return `${names[0]}`;
		if (names.length === 2) return `${names[0]} and ${names[1]}`;
		return `${names[0]} et al.`;
	}

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
	return formatReferenceEntryByStyle(paper, "apa-7", 0);
}

/** Multi-style reference list formatter */
export function formatReferenceEntryByStyle(
	paper: CitePaper,
	styleLabelOrId: string,
	index = 0,
): string {
	const styleLower = (styleLabelOrId || "").toLowerCase().trim();
	const family = getCitationStyleFamily(styleLower);
	const year = citeYear(paper);
	const title = cleanReferenceTitle(paper.title.replace(/\*/g, "").replace(/\]/g, ""));
	const venue = (paper.topics ?? []).find((topic) =>
		/\b(journal|review|quarterly|proceedings|annals|transactions|letters)\b/i.test(topic),
	);
	const url = paper.url?.trim() ?? "";

	// 1. IEEE style: [1] J. K. Author and A. B. Coauthor, "Title," *Venue*, Year. URL
	if (/\bieee\b/.test(styleLower)) {
		const authorFmt = paper.authors.map((raw) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.trim();
			const ini = initialsFromGiven(given, true);
			return ini ? `${ini} ${fam}` : fam;
		});
		let authorLine = "Authors unavailable";
		if (authorFmt.length === 1) authorLine = authorFmt[0]!;
		else if (authorFmt.length === 2) authorLine = `${authorFmt[0]} and ${authorFmt[1]}`;
		else if (authorFmt.length > 2 && authorFmt.length <= 6) {
			authorLine = `${authorFmt.slice(0, -1).join(", ")}, and ${authorFmt[authorFmt.length - 1]}`;
		} else if (authorFmt.length > 6) {
			authorLine = `${authorFmt[0]} et al.`;
		}
		const parts = [
			`[${index + 1}]`,
			`${authorLine},`,
			`"${title},"`,
			venue ? `*${venue.trim()}*,` : "",
			year !== "n.d." ? `${year}.` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 2. Vancouver / AMA / Lancet: [1] Author JK, Coauthor AB. Title. Venue. Year. URL
	if (/\bvancouver\b|\bama\b|\blancet\b/.test(styleLower) || /citation[\s–-]*sequence/.test(styleLower)) {
		const authorFmt = paper.authors.map((raw) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.trim();
			const ini = initialsFromGiven(given, false);
			return ini ? `${fam} ${ini}` : fam;
		});
		let authorLine = "Authors unavailable";
		if (authorFmt.length <= 6) authorLine = authorFmt.join(", ");
		else authorLine = `${authorFmt.slice(0, 3).join(", ")}, et al.`;

		const parts = [
			`[${index + 1}]`,
			`${authorLine}.`,
			`${title}.`,
			venue ? `*${venue.trim()}*.` : "",
			year !== "n.d." ? `${year}.` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 3. Nature / Science / Cell: [1] Author, J. K. & Coauthor, A. B. Title. *Venue* (Year). URL
	if (/\bnature\b|\bscience\b|\bcell\b/.test(styleLower)) {
		const authorLine = formatAuthorLine(paper.authors, 5);
		const parts = [
			`[${index + 1}]`,
			`${authorLine}.`,
			`${title}.`,
			venue ? `*${venue.trim()}*` : "",
			year !== "n.d." ? `(${year}).` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 4. ACS: [1] Author, J. K.; Coauthor, A. B. Title. *Venue* Year. URL
	if (/\bacs\b/.test(styleLower)) {
		const authorFmt = paper.authors.map((raw) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.trim();
			const ini = initialsFromGiven(given, true);
			return ini ? `${fam}, ${ini}` : fam;
		});
		const authorLine = authorFmt.join("; ");
		const parts = [
			`[${index + 1}]`,
			`${authorLine}.`,
			`${title}.`,
			venue ? `*${venue.trim()}*` : "",
			year !== "n.d." ? `${year}.` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 5. MLA 9 / 8: Author, First M., and Second Author. "Title." *Venue*, Year, URL.
	if (family === "mla") {
		const authorFmt = paper.authors.map((raw, idx) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.trim();
			if (idx === 0) {
				return given ? `${fam}, ${given}` : fam;
			}
			return given ? `${given} ${fam}` : fam;
		});
		let authorLine = "Authors unavailable";
		if (authorFmt.length === 1) authorLine = `${authorFmt[0]}`;
		else if (authorFmt.length === 2) authorLine = `${authorFmt[0]}, and ${authorFmt[1]}`;
		else if (authorFmt.length > 2) authorLine = `${authorFmt[0]}, et al.`;

		const parts = [
			`${authorLine.replace(/\.+$/, "")}.`,
			`"${title}."`,
			venue ? `*${venue.trim()}*,` : "",
			year !== "n.d." ? `${year},` : "",
			url ? `${url}.` : "",
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 6. Harvard / Oxford / Elsevier: Author, A. A. and Author, B. B. (Year) 'Title', *Venue*. URL
	if (/\bharvard\b|\boxford\b|\belsevier\b/.test(styleLower)) {
		const authorFmt = paper.authors.map((raw) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.trim();
			const ini = initialsFromGiven(given, true);
			return ini ? `${fam}, ${ini}` : fam;
		});
		let authorLine = "Authors unavailable";
		if (authorFmt.length === 1) authorLine = authorFmt[0]!;
		else if (authorFmt.length === 2) authorLine = `${authorFmt[0]} and ${authorFmt[1]}`;
		else if (authorFmt.length > 2) authorLine = `${authorFmt[0]} et al.`;

		const parts = [
			`${authorLine}`,
			`(${year})`,
			`'${title}',`,
			venue ? `*${venue.trim()}*.` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 7. Chicago Author-Date / ASA / APSA: Author, A. A., and B. B. Author. Year. "Title." *Venue*. URL
	if (/chicago.*author/i.test(styleLower) || /\basa\b|\bapsa\b/.test(styleLower)) {
		const authorFmt = paper.authors.map((raw, idx) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.trim();
			const ini = initialsFromGiven(given, true);
			if (idx === 0) return ini ? `${fam}, ${ini}` : fam;
			return ini ? `${ini} ${fam}` : fam;
		});
		let authorLine = "Authors unavailable";
		if (authorFmt.length === 1) authorLine = authorFmt[0]!;
		else if (authorFmt.length === 2) authorLine = `${authorFmt[0]}, and ${authorFmt[1]}`;
		else if (authorFmt.length > 2) authorLine = `${authorFmt[0]} et al.`;

		const parts = [
			`${authorLine.replace(/\.+$/, "")}.`,
			`${year}.`,
			`"${title}."`,
			venue ? `*${venue.trim()}*.` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 8. Chicago Notes / Turabian notes / Legal: [1] J. K. Author and A. B. Coauthor, "Title," *Venue* (Year). URL
	if (family === "numbered") {
		const authorFmt = paper.authors.map((raw) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.trim();
			const ini = initialsFromGiven(given, true);
			return ini ? `${ini} ${fam}` : fam;
		});
		let authorLine = "Authors unavailable";
		if (authorFmt.length === 1) authorLine = authorFmt[0]!;
		else if (authorFmt.length === 2) authorLine = `${authorFmt[0]} and ${authorFmt[1]}`;
		else if (authorFmt.length > 2) authorLine = `${authorFmt[0]} et al.`;

		const parts = [
			`[${index + 1}]`,
			`${authorLine},`,
			`"${title},"`,
			venue ? `*${venue.trim()}*` : "",
			year !== "n.d." ? `(${year}).` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 9. ABNT: AUTHOR, A. A.; AUTHOR, B. B. Title. *Venue*, Year. URL
	if (family === "abnt") {
		const authorFmt = paper.authors.map((raw) => {
			const { family: fam, given } = parseAuthorName(raw);
			if (!fam) return raw.toUpperCase().trim();
			const ini = initialsFromGiven(given, true);
			return ini ? `${fam.toUpperCase()}, ${ini}` : fam.toUpperCase();
		});
		const authorLine = authorFmt.join("; ");
		const parts = [
			`${authorLine}.`,
			`${title}.`,
			venue ? `*${venue.trim()}*,` : "",
			year !== "n.d." ? `${year}.` : "",
			url,
		].filter(Boolean);
		return parts.join(" ").replace(/\s+/g, " ").trim();
	}

	// 10. BibTeX
	if (family === "bibtex") {
		const firstFam = (paperFamilyNames(paper.authors)[0] ?? "paper").toLowerCase().replace(/[^a-z0-9]/g, "");
		const citeKey = `${firstFam}${year}`;
		const authorStr = paper.authors.join(" and ");
		return `@article{${citeKey},\n  author = {${authorStr}},\n  title = {${title}},\n  year = {${year}},\n  journal = {${venue ?? "Preprint"}},\n  url = {${url}}\n}`;
	}

	// Default: APA 7 (Author, A. A., & Author, B. B. (Year). Title. *Venue*. URL)
	const authorLine = formatAuthorLine(paper.authors);
	const parts = [
		`${authorLine} (${year}).`,
		`${title}.`,
		venue ? `*${venue.trim()}*.` : "",
		url,
	].filter(Boolean);
	return parts.join(" ").replace(/\s+/g, " ").trim();
}

/** Get concise prompt instructions for LLM paper generation tailored to the chosen citation style */
export function getCitationStyleInstructions(styleLabelOrId: string): {
	inTextRule: string;
	referencesRule: string;
	useThisCitePattern: string;
} {
	const label = styleLabelOrId?.trim() || "APA 7th edition";
	const family = getCitationStyleFamily(label);

	if (family === "numbered") {
		return {
			inTextRule: `In-text citations (hard): Use ONLY numbered bracket citations like [1], [2], [1, 2] corresponding to the numbered reference list. Never use author–year parentheticals like (Author, Year). Put numbered bracket cites throughout all body sections.`,
			referencesRule: `References section: List references numbered in bracket order ([1], [2], [3]...) matching the order of appearance in ${label} style. Every number cited in-text must have an entry in References, and every References entry must be cited in-text.`,
			useThisCitePattern: "[n]",
		};
	}

	if (family === "mla") {
		return {
			inTextRule: `In-text citations (hard): Use MLA parenthetical citations like (Author) or (Author and Author) or (Author et al.). Do not include publication year in parentheticals unless needed for disambiguation.`,
			referencesRule: `References section (Works Cited): Format all entries in ${label} alphabetical by author last name: Author, First. "Title." *Venue*, Year, URL.`,
			useThisCitePattern: "(Author)",
		};
	}

	if (family === "abnt") {
		return {
			inTextRule: `In-text citations (hard): Use ABNT uppercase parenthetical citations like (AUTHOR, Year) or (AUTHOR; AUTHOR, Year).`,
			referencesRule: `References section: Format in ABNT standard: AUTHOR, A. A. Title. *Venue*, Year. URL.`,
			useThisCitePattern: "(AUTHOR, Year)",
		};
	}

	// author-date
	return {
		inTextRule: `In-text citations (hard): Use ONLY bracket/parenthetical USE THIS CITE author–year forms matching ${label} (e.g. (Author, Year) or (Author & Author, Year)). Put parentheticals on body paragraphs from Introduction through Conclusion.`,
		referencesRule: `References section: Format all entries in ${label} alphabetical by author last name (Author, A. A. (Year). Title. Source. URL). Every in-text citation must match a References entry.`,
		useThisCitePattern: "(Author, Year)",
	};
}
