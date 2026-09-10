export const REVIEW_TRAIL_TYPES = [
	"submitted",
	"rewrite_requested",
	"approved",
] as const;

export type ReviewTrailType = (typeof REVIEW_TRAIL_TYPES)[number];

export type ReviewTrailEventInput = {
	type: ReviewTrailType;
	at?: Date;
	actorId?: string;
	remark?: string;
	contentHtml?: string;
	annotatedHtml?: string;
	versionNumber?: number;
	wordCount?: number;
};

export type ReviewTrailPlain = {
	_id?: unknown;
	type: ReviewTrailType;
	at: Date;
	actorId?: unknown;
	remark: string;
	contentHtml: string;
	annotatedHtml: string;
	versionNumber?: number;
	wordCount?: number;
};

export type SerializedReviewTrailEvent = {
	_id?: string;
	type: ReviewTrailType;
	at: string;
	actorId?: string;
	remark: string;
	contentHtml: string;
	annotatedHtml: string;
	versionNumber?: number;
	wordCount?: number;
};

type PageTrailHost = {
	reviewTrail?: unknown;
	reviewRemark?: string | null;
	reviewAnnotatedHtml?: string | null;
	reviewStatus?: string | null;
	reviewedAt?: Date | null;
	reviewedBy?: unknown;
	content?: string | null;
	set?: (path: string, val: unknown) => void;
};

const REMARK_MAX = 50_000;
const CONTENT_MAX = 500_000;
const ANNOTATED_MAX = 1_500_000;
const TRAIL_KEEP_HTML = 12;

export function countWordsFromHtml(html: string): number {
	const text = String(html || "")
		.replace(/<[^>]+>/g, " ")
		.replace(/&nbsp;/gi, " ")
		.replace(/\s+/g, " ")
		.trim();
	return text ? text.split(/\s+/).length : 0;
}

function isTrailType(value: unknown): value is ReviewTrailType {
	return (
		value === "submitted" ||
		value === "rewrite_requested" ||
		value === "approved"
	);
}

function toPlainEvent(item: unknown): ReviewTrailPlain | null {
	if (!item || typeof item !== "object") return null;
	const raw = item as {
		toObject?: () => Record<string, unknown>;
	} & Record<string, unknown>;
	const obj =
		typeof raw.toObject === "function" ? raw.toObject() : { ...raw };
	if (!isTrailType(obj.type)) return null;
	const atRaw = obj.at;
	const at =
		atRaw instanceof Date
			? atRaw
			: atRaw
				? new Date(String(atRaw))
				: new Date();
	return {
		_id: obj._id,
		type: obj.type,
		at: Number.isNaN(at.getTime()) ? new Date() : at,
		actorId: obj.actorId,
		remark: String(obj.remark || "").slice(0, REMARK_MAX),
		contentHtml: String(obj.contentHtml || "").slice(0, CONTENT_MAX),
		annotatedHtml: String(obj.annotatedHtml || "").slice(0, ANNOTATED_MAX),
		versionNumber:
			typeof obj.versionNumber === "number" ? obj.versionNumber : undefined,
		wordCount: typeof obj.wordCount === "number" ? obj.wordCount : undefined,
	};
}

export function readPageReviewTrail(page: PageTrailHost): ReviewTrailPlain[] {
	const raw = page.reviewTrail;
	if (!Array.isArray(raw)) return [];
	return raw.map(toPlainEvent).filter((row): row is ReviewTrailPlain => Boolean(row));
}

function writeTrail(page: PageTrailHost, trail: ReviewTrailPlain[]) {
	const payload = trail.map((event) => {
		const row: Record<string, unknown> = {
			type: event.type,
			at: event.at,
			remark: event.remark,
			contentHtml: event.contentHtml,
			annotatedHtml: event.annotatedHtml,
		};
		if (event._id) row._id = event._id;
		if (event.actorId) row.actorId = event.actorId;
		if (typeof event.versionNumber === "number") {
			row.versionNumber = event.versionNumber;
		}
		if (typeof event.wordCount === "number") row.wordCount = event.wordCount;
		return row;
	});
	if (typeof page.set === "function") {
		page.set("reviewTrail", payload);
	} else {
		(page as { reviewTrail: unknown }).reviewTrail = payload;
	}
}

function pruneTrailHtml(trail: ReviewTrailPlain[]) {
	if (trail.length <= TRAIL_KEEP_HTML) return;
	const keepFrom = trail.length - TRAIL_KEEP_HTML;
	for (let i = 0; i < keepFrom; i += 1) {
		trail[i].contentHtml = "";
		trail[i].annotatedHtml = "";
	}
}

function normalizeEvent(event: ReviewTrailEventInput): ReviewTrailPlain {
	const contentHtml = String(event.contentHtml || "").slice(0, CONTENT_MAX);
	const annotatedHtml = String(event.annotatedHtml || "").slice(
		0,
		ANNOTATED_MAX,
	);
	const wordCount =
		typeof event.wordCount === "number"
			? event.wordCount
			: countWordsFromHtml(contentHtml || annotatedHtml);
	return {
		type: event.type,
		at: event.at instanceof Date ? event.at : new Date(),
		actorId: event.actorId || undefined,
		remark: String(event.remark || "").slice(0, REMARK_MAX),
		contentHtml,
		annotatedHtml,
		versionNumber: event.versionNumber,
		wordCount,
	};
}

/** Seed one event from the latest overwritten remark so existing work is not invisible. */
export function backfillPageReviewTrail(page: PageTrailHost): boolean {
	const existing = readPageReviewTrail(page);
	if (existing.length > 0) return false;

	const remark = String(page.reviewRemark || "").trim();
	const annotated = String(page.reviewAnnotatedHtml || "").trim();
	const status = String(page.reviewStatus || "none");
	if (
		!remark &&
		!annotated &&
		status !== "approved" &&
		status !== "needs_revision"
	) {
		return false;
	}

	const type: ReviewTrailType =
		status === "approved" ? "approved" : "rewrite_requested";
	const contentHtml = String(page.content || "");
	existing.push({
		type,
		at: page.reviewedAt instanceof Date ? page.reviewedAt : new Date(),
		actorId: page.reviewedBy,
		remark,
		contentHtml,
		annotatedHtml: annotated,
		wordCount: countWordsFromHtml(contentHtml || annotated),
	});
	writeTrail(page, existing);
	return true;
}

export function pushPageReviewTrail(
	page: PageTrailHost,
	event: ReviewTrailEventInput,
): void {
	backfillPageReviewTrail(page);
	const trail = readPageReviewTrail(page);
	trail.push(normalizeEvent(event));
	pruneTrailHtml(trail);
	writeTrail(page, trail);
}

export function serializeReviewTrail(
	page: PageTrailHost,
): SerializedReviewTrailEvent[] {
	return readPageReviewTrail(page).map((event) => ({
		_id: event._id ? String(event._id) : undefined,
		type: event.type,
		at: event.at instanceof Date ? event.at.toISOString() : String(event.at),
		actorId: event.actorId ? String(event.actorId) : undefined,
		remark: event.remark,
		contentHtml: event.contentHtml,
		annotatedHtml: event.annotatedHtml,
		versionNumber: event.versionNumber,
		wordCount: event.wordCount,
	}));
}

export function slimReviewTrailForList(
	pages: unknown,
): unknown {
	if (!Array.isArray(pages)) return pages;
	return pages.map((page) => {
		if (!page || typeof page !== "object") return page;
		const record = page as Record<string, unknown>;
		const trail = record.reviewTrail;
		if (!Array.isArray(trail)) return page;
		return {
			...record,
			reviewTrail: trail.map((event) => {
				if (!event || typeof event !== "object") return event;
				const row = event as Record<string, unknown>;
				return {
					...row,
					contentHtml: "",
					annotatedHtml: "",
				};
			}),
		};
	});
}
