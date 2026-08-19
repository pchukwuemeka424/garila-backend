import { paperFamilyNames, paperYear } from "../lib/citation-bank.js";
import type { AlphaXivPaper, RetrievalProtocol } from "./alphaxiv.service.js";
import {
	formatExtractionTable,
	formatSearchedApis,
	formatSelectionFlowTable,
	inferEvidenceCard,
	looksLikeLiteratureReview,
} from "./alphaxiv.service.js";

const METHOD_HEADING =
	/^(?:#{1,6}\s+|\*\*)(Methodology|Methods|Chapter Three:[^*#\n]+)(?:\*\*)?\s*$/im;

const INVENTED_DATABASE_LIST =
	/(?:Web of Science|Scopus|ERIC|IEEE Xplore|PubMed|Google Scholar|ScienceDirect|ProQuest|Dimensions)(?:\s*,\s*(?:and\s+)?(?:Web of Science|Scopus|ERIC|IEEE Xplore|PubMed|Google Scholar|ScienceDirect|ProQuest|Dimensions))+/gi;

const DUAL_REVIEWER =
	/\b(?:two|multiple|independent)\s+reviewers?\s+(?:independently\s+)?(?:assessed|screened|reviewed|coded|appraised)[^.?!]*[.?!]/gi;

const PRISMA_FOLLOWED =
	/\b(?:followed|follows|following|in accordance with|according to)\s+(?:the\s+)?PRISMA(?:\s+2020)?(?:\s+\([^)]+\))?(?:\s+guidelines?)?[^.?!]*/gi;

const DATE_WINDOW = /\bbetween\s+((?:19|20)\d{2})\s+and\s+((?:19|20)\d{2})\b/gi;
const DATE_FROM_TO = /\bfrom\s+((?:19|20)\d{2})\s+to\s+((?:19|20)\d{2})\b/gi;

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

const NEXT_MAJOR_HEADING =
	/\n(?:#{1,6}\s+|\*\*)(Literature Review|Related Work|Results(?:\s*\/\s*Analysis)?|Findings(?:\s*\/\s*Results)?|Discussion|Conclusion|Critical Analysis|References)(?:\*\*)?\s*\n/i;

function nextSectionStart(body: string, from: number): number {
	const rest = body.slice(from);
	const match = rest.match(NEXT_MAJOR_HEADING);
	if (!match || match.index === undefined) return body.length;
	return from + match.index;
}

function splitMethodSection(body: string): { before: string; heading: string; section: string; after: string } | null {
	const match = body.match(METHOD_HEADING);
	if (!match || match.index === undefined) return null;
	const headingEnd = match.index + match[0].length;
	const sectionEnd = nextSectionStart(body, headingEnd);
	return {
		before: body.slice(0, match.index),
		heading: match[0].trim(),
		section: body.slice(headingEnd, sectionEnd),
		after: body.slice(sectionEnd),
	};
}

function sanitizeMethodProse(section: string, protocol: RetrievalProtocol): string {
	const apis = formatSearchedApis(protocol);
	const yearLabel =
		protocol.yearMin && protocol.yearMax
			? `${protocol.yearMin}–${protocol.yearMax}`
			: "the years represented in the retrieved corpus";

	let next = section.replace(INVENTED_DATABASE_LIST, `the retrieved scholarly APIs (${apis})`);
	next = next.replace(DUAL_REVIEWER, "Eligibility screening was applied automatically by the retrieval pipeline (deduplication and topic filtering), not by independent human reviewers.");
	next = next.replace(
		PRISMA_FOLLOWED,
		"is informed by PRISMA reporting items (identification, deduplication, eligibility, inclusion) but is not a registered dual-screener PRISMA 2020 review",
	);
	next = next.replace(DATE_WINDOW, yearLabel);
	next = next.replace(DATE_FROM_TO, yearLabel);
	next = next.replace(
		/\b(?:a |this )?(?:systematic(?: literature)? review)\s+(?:was|is)\s+conducted\s+in accordance with PRISMA[^.?!]*/gi,
		"This document is a structured review of the retrieved corpus",
	);
	return next;
}

function ensureTables(section: string, protocol: RetrievalProtocol, papers: AlphaXivPaper[]): string {
	let next = section.trimEnd();
	if (!/Records identified across listed APIs/.test(next)) {
		next += `\n\n**Table 1.** Selection of the working corpus from the retrieval protocol.\n\n${formatSelectionFlowTable(protocol)}`;
	}
	if (!/Evidence type \(from title\/abstract\)/.test(next)) {
		next += `\n\n**Table 2.** Included records with evidence type and population taken from titles/abstracts only.\n\n${formatExtractionTable(papers)}`;
	}
	if (!/not a registered dual-screener PRISMA/.test(next) && !/not a registered dual-screener/.test(next)) {
		next += `\n\nSearch date (UTC): ${protocol.searchedAt}. Query: "${protocol.query}". Sources actually searched: ${formatSearchedApis(protocol)}. Included N = ${protocol.included}. This is not a registered dual-screener PRISMA 2020 review.`;
	}
	return `${next}\n`;
}

function softenCausalReviewTitle(body: string, topicHint: string): string {
	if (!looksLikeLiteratureReview(topicHint) && !looksLikeLiteratureReview(body.slice(0, 400))) {
		return body;
	}
	return body
		.replace(
			/^(\*\*)?The Impact of (.+?) on (.+?): A Systematic(?: Literature)? Review(\*\*)?/im,
			"$1$2 in $3: A structured review of retrieved literature$4",
		)
		.replace(
			/^(\*\*)?The Impact of (.+?): A Systematic(?: Literature)? Review(\*\*)?/im,
			"$1$2: A structured review of retrieved literature$3",
		)
		.replace(
			/: A Systematic(?: Literature)? Review(\*\*)?\s*$/im,
			": A structured review of retrieved literature$1",
		);
}

function correctStudentFacultyMismatches(body: string, papers: AlphaXivPaper[]): string {
	let next = body;
	for (const paper of papers) {
		const card = inferEvidenceCard(paper);
		const studentOnly =
			/\bstudents?\b/i.test(card.population) && !/\bfaculty/i.test(card.population);
		if (!studentOnly) continue;
		const family = paperFamilyNames(paper.authors)[0];
		if (!family) continue;
		const year = paperYear(paper.publicationDate);
		const author = escapeRegExp(family);
		const pattern = new RegExp(
			`(${author}(?:\\s+and\\s+[A-Z][A-Za-z'-]+|\\s+et al\\.)?(?:\\s*\\(\\s*${year}\\s*\\)|\\s*,\\s*${year})[^.]{0,160}?)\\bfaculty members\\b`,
			"gi",
		);
		next = next.replace(pattern, "$1university students");
		next = next.replace(
			new RegExp(
				`(${author}(?:\\s+and\\s+[A-Z][A-Za-z'-]+|\\s+et al\\.)?(?:\\s*\\(\\s*${year}\\s*\\)|\\s*,\\s*${year})[^.]{0,160}?)\\bfaculty\\b`,
				"gi",
			),
			"$1students",
		);
	}
	return next;
}

function hedgePerspectiveAsEmpirical(body: string, papers: AlphaXivPaper[]): string {
	let next = body;
	for (const paper of papers) {
		const card = inferEvidenceCard(paper);
		if (!/Perspective|commentary|agenda/i.test(card.type)) continue;
		const family = paperFamilyNames(paper.authors)[0];
		if (!family) continue;
		const year = paperYear(paper.publicationDate);
		const author = escapeRegExp(family);
		const pattern = new RegExp(
			`(${author}(?:\\s+et al\\.)?(?:\\s*\\(\\s*${year}\\s*\\)|\\s*,\\s*${year}|\\s*\\(\\s*(?:19|20)\\d{2}\\s*\\))?[^.]{0,200}?(?:acceptance|reported that|found that|measured)[^.?!]*)([.?!])`,
			"gi",
		);
		next = next.replace(
			pattern,
			"$1 — this source is a perspective/agenda paper rather than an empirical measurement$2",
		);
	}
	return next;
}

export function sanitizeReviewMethodology(
	content: string,
	papers: AlphaXivPaper[],
	options?: { protocol?: RetrievalProtocol; topic?: string | null },
): string {
	if (!content.trim()) return content;
	const topicHint = `${options?.topic ?? ""}\n${content.slice(0, 500)}`;
	let next = softenCausalReviewTitle(content, topicHint);
	next = correctStudentFacultyMismatches(next, papers);
	next = hedgePerspectiveAsEmpirical(next, papers);

	const protocol = options?.protocol;
	if (!protocol || protocol.included === 0) return next;

	const isReview =
		looksLikeLiteratureReview(topicHint) ||
		looksLikeLiteratureReview(content.slice(0, 800)) ||
		/\bPRISMA\b/i.test(content);

	const parts = splitMethodSection(next);
	if (parts) {
		let section = sanitizeMethodProse(parts.section, protocol);
		if (
			isReview ||
			/(?:Web of Science|Scopus|ERIC|IEEE Xplore)/i.test(parts.section) ||
			/\bPRISMA\b/i.test(parts.section)
		) {
			section = ensureTables(section, protocol, papers);
		}
		next = `${parts.before}${parts.heading}\n\n${section.trim()}\n${parts.after}`;
		return next;
	}

	if (isReview) {
		const insert = [
			"",
			"**Methodology**",
			"",
			`This document is a structured review of ${protocol.included} records retrieved on ${protocol.searchedAt} via ${formatSearchedApis(protocol)} for the query "${protocol.query}". It is informed by PRISMA reporting items but is not a registered dual-screener PRISMA 2020 review.`,
			"",
			"**Table 1.** Selection of the working corpus from the retrieval protocol.",
			"",
			formatSelectionFlowTable(protocol),
			"",
			"**Table 2.** Included records with evidence type and population taken from titles/abstracts only.",
			"",
			formatExtractionTable(papers),
			"",
		].join("\n");
		const refs = next.search(/^(?:#{1,6}\s+|\*\*)References(?:\*\*)?\s*$/im);
		if (refs >= 0) {
			return `${next.slice(0, refs).trimEnd()}\n${insert}\n${next.slice(refs)}`;
		}
		return `${next.trimEnd()}\n${insert}`;
	}

	return next;
}
