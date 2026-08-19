import {
	getHuggingFaceEmbedModel,
	getHuggingFaceNliModel,
	getHuggingFaceToken,
	isHuggingFaceEnabled,
} from "../config/env.js";

export type HfPaper = {
	title: string;
	abstract: string;
};

const INFERENCE_URLS = [
	"https://router.huggingface.co/hf-inference/models",
	"https://api-inference.huggingface.co/models",
];
const REQUEST_TIMEOUT_MS = 20_000;
const NLI_CAP = 16;
const CONTRADICTION_THRESHOLD = 0.72;

function paperText(paper: HfPaper): string {
	const title = paper.title.replace(/\s+/g, " ").trim();
	const abstract = paper.abstract.replace(/\s+/g, " ").trim().slice(0, 500);
	return abstract ? `${title}. ${abstract}` : title;
}

function meanPool(matrix: number[][]): number[] {
	const width = matrix[0]?.length ?? 0;
	const out = new Array(width).fill(0) as number[];
	if (!width || matrix.length === 0) return out;
	for (const row of matrix) {
		for (let i = 0; i < width; i += 1) out[i] += row[i] ?? 0;
	}
	for (let i = 0; i < width; i += 1) out[i] /= matrix.length;
	return out;
}

function asVector(raw: unknown): number[] | null {
	if (!Array.isArray(raw) || raw.length === 0) return null;
	if (typeof raw[0] === "number") return raw as number[];
	if (Array.isArray(raw[0]) && typeof (raw[0] as unknown[])[0] === "number") {
		return meanPool(raw as number[][]);
	}
	if (Array.isArray(raw[0]) && Array.isArray((raw[0] as unknown[])[0])) {
		return asVector(raw[0]);
	}
	return null;
}

function cosine(a: number[], b: number[]): number {
	const n = Math.min(a.length, b.length);
	let dot = 0;
	let na = 0;
	let nb = 0;
	for (let i = 0; i < n; i += 1) {
		const av = a[i] ?? 0;
		const bv = b[i] ?? 0;
		dot += av * bv;
		na += av * av;
		nb += bv * bv;
	}
	const denom = Math.sqrt(na) * Math.sqrt(nb);
	return denom === 0 ? 0 : dot / denom;
}

async function inferenceRequest(
	model: string,
	body: unknown,
	signal?: AbortSignal,
): Promise<unknown> {
	const token = getHuggingFaceToken();
	if (!token) return null;

	let lastError: unknown;
	for (const base of INFERENCE_URLS) {
		const controller = new AbortController();
		const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
		const onAbort = () => controller.abort();
		signal?.addEventListener("abort", onAbort, { once: true });
		try {
			const response = await fetch(`${base}/${model}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify(body),
				signal: controller.signal,
			});
			if (response.status === 503) {
				await new Promise((resolve) => setTimeout(resolve, 1500));
				continue;
			}
			if (!response.ok) {
				lastError = new Error(`Hugging Face ${response.status}`);
				continue;
			}
			return await response.json();
		} catch (error) {
			lastError = error;
		} finally {
			clearTimeout(timeout);
			signal?.removeEventListener("abort", onAbort);
		}
	}
	if (lastError) {
		console.warn("[huggingface] inference failed", lastError instanceof Error ? lastError.message : lastError);
	}
	return null;
}

async function embedTexts(texts: string[], signal?: AbortSignal): Promise<number[][] | null> {
	if (texts.length === 0) return [];
	const model = getHuggingFaceEmbedModel();
	const payload = await inferenceRequest(model, { inputs: texts.length === 1 ? texts[0] : texts }, signal);
	if (payload == null) return null;

	if (texts.length === 1) {
		const vector = asVector(payload);
		return vector ? [vector] : null;
	}

	if (!Array.isArray(payload)) return null;
	const vectors: number[][] = [];
	for (const item of payload) {
		const vector = asVector(item);
		if (!vector) return null;
		vectors.push(vector);
	}
	return vectors.length === texts.length ? vectors : null;
}

/** Rank retrieved papers by semantic similarity to the query. Falls back to API order. */
export async function rerankPapers<T extends HfPaper>(
	query: string,
	papers: T[],
	options?: { signal?: AbortSignal; minScore?: number },
): Promise<T[]> {
	if (!isHuggingFaceEnabled() || papers.length < 2 || !query.trim()) return papers;
	if (options?.signal?.aborted) return papers;

	try {
		const texts = [query.trim().slice(0, 500), ...papers.map((paper) => paperText(paper))];
		const vectors = await embedTexts(texts, options?.signal);
		if (!vectors || vectors.length !== texts.length) return papers;

		const queryVec = vectors[0]!;
		const minScore = options?.minScore ?? 0.12;
		const ranked = papers
			.map((paper, index) => ({
				paper,
				score: cosine(queryVec, vectors[index + 1] ?? []),
			}))
			.sort((a, b) => b.score - a.score);

		const filtered = ranked.filter((row) => row.score >= minScore).map((row) => row.paper);
		return filtered.length >= Math.min(4, papers.length) ? filtered : ranked.map((row) => row.paper);
	} catch (error) {
		console.warn(
			"[huggingface] rerank skipped",
			error instanceof Error ? error.message : error,
		);
		return papers;
	}
}

export type CitedClaim = {
	sentence: string;
	paper: HfPaper;
};

export type FactCheckResult = {
	sentence: string;
	contradicted: boolean;
};

async function classifySupport(
	title: string,
	abstract: string,
	claim: string,
	signal?: AbortSignal,
): Promise<"entailment" | "neutral" | "contradiction" | null> {
	const model = getHuggingFaceNliModel();
	const payload = await inferenceRequest(
		model,
		{
			inputs: `Paper title: ${title.slice(0, 220)}\nAbstract: ${abstract.slice(0, 700)}\n\nClaim: ${claim.slice(0, 400)}`,
			parameters: {
				candidate_labels: ["entailment", "neutral", "contradiction"],
			},
		},
		signal,
	);
	if (!payload || typeof payload !== "object") return null;
	const labels = (payload as { labels?: unknown }).labels;
	const scores = (payload as { scores?: unknown }).scores;
	if (!Array.isArray(labels) || labels.length === 0) return null;
	const labelList = labels.map((label) => String(label ?? "").toLowerCase());
	const scoreList = Array.isArray(scores) ? scores.map((score) => (typeof score === "number" ? score : 0)) : [];
	const top = labelList[0] ?? "";
	const topScore = scoreList[0] ?? 1;
	const entailScore = scoreList[labelList.findIndex((label) => label.includes("entail"))] ?? 0;
	if (top.includes("entail")) return "entailment";
	if (top.includes("contradict") && topScore >= CONTRADICTION_THRESHOLD && entailScore < 0.25) {
		return "contradiction";
	}
	return "neutral";
}

export async function factCheckCitedClaims(
	claims: CitedClaim[],
	options?: { signal?: AbortSignal },
): Promise<FactCheckResult[]> {
	if (!isHuggingFaceEnabled() || claims.length === 0) {
		return claims.map((claim) => ({ sentence: claim.sentence, contradicted: false }));
	}

	const limited = claims.slice(0, NLI_CAP);
	const results: FactCheckResult[] = [];
	for (const claim of limited) {
		if (options?.signal?.aborted) break;
		const abstract = claim.paper.abstract?.trim();
		if (!abstract) {
			results.push({ sentence: claim.sentence, contradicted: false });
			continue;
		}
		try {
			const verdict = await classifySupport(
				claim.paper.title ?? "",
				abstract,
				claim.sentence,
				options?.signal,
			);
			results.push({
				sentence: claim.sentence,
				contradicted: verdict === "contradiction",
			});
		} catch {
			results.push({ sentence: claim.sentence, contradicted: false });
		}
	}
	return results;
}
