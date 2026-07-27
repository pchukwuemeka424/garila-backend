import { Types } from "mongoose";

import { getOpenRouterFastModel } from "../config/env.js";
import { ResearchDatasetModel } from "../db/models/ResearchDataset.js";
import { ResearchProjectModel } from "../db/models/ResearchProject.js";
import { completeOpenRouterChat } from "./llm.service.js";

export type GraphChartType = "bar" | "line" | "area" | "pie" | "scatter";

export type GraphExplanation = {
	summary: string;
	insights: string[];
	takeaways: string;
	caveats: string;
	generatedBy: "agent" | "heuristic";
};

export type GraphInstructionPlan = {
	goal: string;
	preferredChartType?: GraphChartType | null;
	xKeyHint?: string | null;
	yKeyHints?: string[];
	categoryHint?: string | null;
	valueHint?: string | null;
	filters?: string[];
	sortBy?: string | null;
	sortDirection?: "asc" | "desc" | null;
	limit?: number | null;
	aggregation?: "none" | "sum" | "avg" | "count" | null;
	titleHint?: string | null;
	notes?: string;
	interpretedBy: "agent" | "heuristic";
};

export type GraphAgentStep = {
	id: string;
	agent: string;
	status: "ok" | "skipped" | "fallback";
	detail: string;
};

export type GraphPlotResult = {
	chartType: GraphChartType;
	title: string;
	description: string;
	xKey: string;
	yKeys: string[];
	nameKey?: string;
	valueKey?: string;
	series: Array<Record<string, string | number>>;
	columns: string[];
	rowCount: number;
	usedAgent: boolean;
	datasetTitle: string;
	explanation: GraphExplanation;
	userPrompt?: string;
	instructionPlan?: GraphInstructionPlan | null;
	agentSteps?: GraphAgentStep[];
};

const CHART_TYPES = new Set<GraphChartType>(["bar", "line", "area", "pie", "scatter"]);

function requireUserId(userId?: string | null): string {
	if (!userId?.trim()) throw new Error("Sign in required.");
	return userId.trim();
}

function decodeDataUrl(dataUrl: string): string {
	const match = /^data:([^;]+);base64,(.+)$/i.exec(dataUrl.trim());
	if (!match) {
		// plain text stored without data URL prefix
		return dataUrl;
	}
	return Buffer.from(match[2], "base64").toString("utf8");
}

function parseCsvLine(line: string): string[] {
	const cells: string[] = [];
	let current = "";
	let inQuotes = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inQuotes) {
			if (ch === '"') {
				if (line[i + 1] === '"') {
					current += '"';
					i++;
				} else {
					inQuotes = false;
				}
			} else {
				current += ch;
			}
			continue;
		}
		if (ch === '"') {
			inQuotes = true;
			continue;
		}
		if (ch === "," || ch === "\t") {
			cells.push(current.trim());
			current = "";
			continue;
		}
		current += ch;
	}
	cells.push(current.trim());
	return cells;
}

function parseTabularText(raw: string): { columns: string[]; rows: Record<string, string>[] } {
	const lines = raw
		.replace(/^\uFEFF/, "")
		.split(/\r?\n/)
		.map((l) => l.trimEnd())
		.filter((l) => l.trim().length > 0);
	if (lines.length < 2) throw new Error("Dataset needs a header row and at least one data row.");

	const delimiter = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
	const headerCells =
		delimiter === "\t" ? lines[0].split("\t").map((c) => c.trim()) : parseCsvLine(lines[0]);
	const columns = headerCells.map((c, i) => c || `col_${i + 1}`);
	const seen = new Map<string, number>();
	const uniqueColumns = columns.map((name) => {
		const count = (seen.get(name) ?? 0) + 1;
		seen.set(name, count);
		return count > 1 ? `${name}_${count}` : name;
	});

	const rows: Record<string, string>[] = [];
	for (const line of lines.slice(1)) {
		const cells = delimiter === "\t" ? line.split("\t") : parseCsvLine(line);
		if (cells.every((c) => !c.trim())) continue;
		const row: Record<string, string> = {};
		uniqueColumns.forEach((col, i) => {
			row[col] = (cells[i] ?? "").trim();
		});
		rows.push(row);
	}
	if (rows.length === 0) throw new Error("No data rows found in dataset.");
	return { columns: uniqueColumns, rows };
}

function parseJsonDataset(raw: string): { columns: string[]; rows: Record<string, string>[] } {
	const parsed = JSON.parse(raw) as unknown;
	let arr: unknown[] = [];
	if (Array.isArray(parsed)) arr = parsed;
	else if (parsed && typeof parsed === "object") {
		const obj = parsed as Record<string, unknown>;
		const firstArray = Object.values(obj).find((v) => Array.isArray(v));
		if (Array.isArray(firstArray)) arr = firstArray;
		else throw new Error("JSON dataset must be an array of objects.");
	} else {
		throw new Error("Unsupported JSON structure.");
	}

	const objectRows = arr.filter((r) => r && typeof r === "object" && !Array.isArray(r)) as Record<
		string,
		unknown
	>[];
	if (objectRows.length === 0) throw new Error("JSON dataset has no object rows.");

	const columns: string[] = [];
	for (const row of objectRows.slice(0, 50)) {
		for (const key of Object.keys(row)) {
			if (!columns.includes(key)) columns.push(key);
		}
	}

	const rows = objectRows.map((row) => {
		const out: Record<string, string> = {};
		for (const col of columns) {
			const val = row[col];
			out[col] = val == null ? "" : String(val);
		}
		return out;
	});
	return { columns, rows };
}

function isNumericValue(value: string): boolean {
	if (!value.trim()) return false;
	const cleaned = value.replace(/,/g, "").replace(/%$/, "").trim();
	return /^-?\d+(\.\d+)?$/.test(cleaned);
}

function toNumber(value: string): number {
	const cleaned = value.replace(/,/g, "").replace(/%$/, "").trim();
	return Number(cleaned);
}

function detectNumericColumns(columns: string[], rows: Record<string, string>[]): string[] {
	return columns.filter((col) => {
		let numeric = 0;
		let samples = 0;
		for (const row of rows.slice(0, 40)) {
			const v = row[col];
			if (!v?.trim()) continue;
			samples++;
			if (isNumericValue(v)) numeric++;
		}
		return samples > 0 && numeric / samples >= 0.6;
	});
}

function heuristicPlot(
	chartType: GraphChartType,
	columns: string[],
	rows: Record<string, string>[],
	datasetTitle: string,
	prompt?: string,
): GraphPlotResult {
	const numericCols = detectNumericColumns(columns, rows);
	const categoricalCols = columns.filter((c) => !numericCols.includes(c));
	const xKey = categoricalCols[0] || columns[0];
	const yKeys =
		numericCols.length > 0
			? numericCols.slice(0, chartType === "pie" ? 1 : 3)
			: columns.filter((c) => c !== xKey).slice(0, 1);

	if (yKeys.length === 0) {
		throw new Error("Could not find a numeric column to plot. Check your dataset.");
	}

	const limited = rows.slice(0, chartType === "pie" ? 24 : 80);
	const series = limited.map((row) => {
		const point: Record<string, string | number> = { [xKey]: row[xKey] ?? "" };
		for (const y of yKeys) {
			const raw = row[y] ?? "";
			point[y] = isNumericValue(raw) ? toNumber(raw) : 0;
		}
		return point;
	});

	return {
		chartType,
		title: `${datasetTitle} — ${chartType} chart`,
		description: prompt?.trim()
			? `Plotted with heuristic mapping for: “${prompt.trim()}”.`
			: `Auto-selected ${xKey} vs ${yKeys.join(", ")}.`,
		xKey,
		yKeys,
		nameKey: chartType === "pie" ? xKey : undefined,
		valueKey: chartType === "pie" ? yKeys[0] : undefined,
		series,
		columns,
		rowCount: rows.length,
		usedAgent: false,
		datasetTitle,
		explanation: {
			summary: "",
			insights: [],
			takeaways: "",
			caveats: "",
			generatedBy: "heuristic",
		},
	};
}

type AgentMapping = {
	title?: string;
	description?: string;
	xKey?: string;
	yKeys?: string[];
	nameKey?: string;
	valueKey?: string;
	sortBy?: string;
	sortDirection?: "asc" | "desc";
	limit?: number;
};

type AgentExplanationJson = {
	summary?: string;
	insights?: string[];
	takeaways?: string;
	caveats?: string;
};

type InstructionPlanJson = {
	goal?: string;
	preferredChartType?: string;
	xKeyHint?: string;
	yKeyHints?: string[];
	categoryHint?: string;
	valueHint?: string;
	filters?: string[];
	sortBy?: string;
	sortDirection?: string;
	limit?: number;
	aggregation?: string;
	titleHint?: string;
	notes?: string;
};

function extractJsonObject<T extends object>(text: string): T | null {
	const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(text);
	const candidate = fenced?.[1]?.trim() || text.trim();
	const start = candidate.indexOf("{");
	const end = candidate.lastIndexOf("}");
	if (start < 0 || end <= start) return null;
	try {
		return JSON.parse(candidate.slice(start, end + 1)) as T;
	} catch {
		return null;
	}
}

function resolveColumnHint(hint: string | null | undefined, columns: string[]): string | null {
	const raw = hint?.trim();
	if (!raw) return null;
	const exact = columns.find((c) => c === raw);
	if (exact) return exact;
	const lower = raw.toLowerCase();
	const caseMatch = columns.find((c) => c.toLowerCase() === lower);
	if (caseMatch) return caseMatch;
	const partial = columns.find(
		(c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase()),
	);
	return partial ?? null;
}

function heuristicInstructionPlan(
	prompt: string,
	chartType: GraphChartType,
	columns: string[],
): GraphInstructionPlan {
	const lower = prompt.toLowerCase();
	const matched = columns.filter((c) => lower.includes(c.toLowerCase()));
	return {
		goal: prompt.trim(),
		preferredChartType: null,
		xKeyHint: matched[0] ?? null,
		yKeyHints: matched.slice(1, 4),
		categoryHint: matched[0] ?? null,
		valueHint: matched[1] ?? null,
		filters: [],
		sortBy: null,
		sortDirection:
			lower.includes("desc") || lower.includes("highest") || lower.includes("top")
				? "desc"
				: lower.includes("asc") || lower.includes("lowest")
					? "asc"
					: null,
		limit: (() => {
			const m = /\b(?:top|first|limit)\s+(\d{1,3})\b/i.exec(prompt);
			return m ? Number(m[1]) : null;
		})(),
		aggregation:
			lower.includes("average") || lower.includes("avg")
				? "avg"
				: lower.includes("sum") || lower.includes("total")
					? "sum"
					: lower.includes("count")
						? "count"
						: null,
		titleHint: null,
		notes: `Heuristic parse for ${chartType} chart.`,
		interpretedBy: "heuristic",
	};
}

function seriesStats(plot: GraphPlotResult): {
	yKey: string;
	min: number;
	max: number;
	avg: number;
	total: number;
	peakLabel: string;
	lowLabel: string;
}[] {
	const labelKey = plot.chartType === "pie" ? plot.nameKey || plot.xKey : plot.xKey;
	const valueKeys =
		plot.chartType === "pie"
			? [plot.valueKey || plot.yKeys[0]].filter(Boolean)
			: plot.yKeys;

	return valueKeys.map((yKey) => {
		const pairs = plot.series
			.map((row) => {
				const raw = row[yKey];
				const n = typeof raw === "number" ? raw : Number(raw);
				const label = String(row[labelKey] ?? "");
				return Number.isFinite(n) ? { n, label } : null;
			})
			.filter((p): p is { n: number; label: string } => Boolean(p));

		if (pairs.length === 0) {
			return { yKey, min: 0, max: 0, avg: 0, total: 0, peakLabel: "—", lowLabel: "—" };
		}

		let min = pairs[0];
		let max = pairs[0];
		let total = 0;
		for (const p of pairs) {
			total += p.n;
			if (p.n < min.n) min = p;
			if (p.n > max.n) max = p;
		}
		return {
			yKey,
			min: min.n,
			max: max.n,
			avg: total / pairs.length,
			total,
			peakLabel: max.label || "highest point",
			lowLabel: min.label || "lowest point",
		};
	});
}

function heuristicExplanation(plot: GraphPlotResult, prompt?: string): GraphExplanation {
	const stats = seriesStats(plot);
	const primary = stats[0];
	const chartLabel = plot.chartType;
	const xLabel = plot.chartType === "pie" ? plot.nameKey || plot.xKey : plot.xKey;
	const yLabel =
		plot.chartType === "pie" ? plot.valueKey || plot.yKeys[0] : plot.yKeys.join(", ");

	const insights: string[] = [];
	if (primary) {
		insights.push(
			`Values of ${primary.yKey} range from ${fmtNum(primary.min)} to ${fmtNum(primary.max)} (average ${fmtNum(primary.avg)}).`,
		);
		insights.push(
			`Highest point is at “${primary.peakLabel}” (${fmtNum(primary.max)}); lowest is at “${primary.lowLabel}” (${fmtNum(primary.min)}).`,
		);
		if (plot.chartType === "pie" && primary.total > 0) {
			const share = (primary.max / primary.total) * 100;
			insights.push(`“${primary.peakLabel}” accounts for about ${share.toFixed(1)}% of the total.`);
		}
		if (plot.chartType === "line" || plot.chartType === "area") {
			const first = plot.series[0]?.[primary.yKey];
			const last = plot.series[plot.series.length - 1]?.[primary.yKey];
			const a = typeof first === "number" ? first : Number(first);
			const b = typeof last === "number" ? last : Number(last);
			if (Number.isFinite(a) && Number.isFinite(b) && a !== 0) {
				const change = ((b - a) / Math.abs(a)) * 100;
				insights.push(
					`From the first to last plotted point, ${primary.yKey} changes by about ${change.toFixed(1)}%.`,
				);
			}
		}
	}
	if (plot.yKeys.length > 1) {
		insights.push(
			`Multiple series are shown (${plot.yKeys.join(", ")}), so compare relative patterns across them.`,
		);
	}
	if (prompt?.trim()) {
		insights.push(`Plot request considered: “${prompt.trim()}”.`);
	}

	return {
		summary: `This ${chartLabel} chart shows ${yLabel} across ${xLabel} using ${plot.series.length} plotted points from “${plot.datasetTitle}” (${plot.rowCount} rows in the dataset).`,
		insights: insights.slice(0, 5),
		takeaways: primary
			? `Focus on the contrast between “${primary.peakLabel}” and “${primary.lowLabel}” when interpreting ${primary.yKey}.`
			: "Review the plotted points for patterns before drawing conclusions.",
		caveats:
			"Explanation is derived from the plotted subset of the file. Missing values, outliers, or sampling limits may affect interpretation.",
		generatedBy: "heuristic",
	};
}

function fmtNum(n: number): string {
	if (!Number.isFinite(n)) return "—";
	const abs = Math.abs(n);
	if (abs >= 1000 || Number.isInteger(n)) {
		return new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 }).format(n);
	}
	return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(n);
}

async function agentInterpretInstructions(
	prompt: string,
	chartType: GraphChartType,
	columns: string[],
	sampleRows: Record<string, string>[],
	datasetTitle: string,
): Promise<GraphInstructionPlan | null> {
	try {
		const { text } = await completeOpenRouterChat(
			[
				{
					role: "system",
					content: `You are Agent 1: Instruction Analyst for research data visualization.
Interpret the researcher's natural-language plotting instructions against available columns.
Return ONLY JSON with keys:
- goal: short restatement of what to plot
- preferredChartType: bar|line|area|pie|scatter or null (only if user clearly wants a different type)
- xKeyHint, yKeyHints (array), categoryHint, valueHint: column names from the provided list only, or null/[]
- filters: short strings describing row filters if any
- sortBy: column name or null
- sortDirection: asc|desc|null
- limit: number or null (e.g. top 10)
- aggregation: none|sum|avg|count|null
- titleHint: optional chart title
- notes: 1 short sentence on how you interpreted the request
Never invent columns that are not in the list.`,
				},
				{
					role: "user",
					content: JSON.stringify({
						datasetTitle,
						selectedChartType: chartType,
						instructions: prompt.trim(),
						columns,
						sampleRows: sampleRows.slice(0, 6),
					}),
				},
			],
			{ model: getOpenRouterFastModel(), maxTokens: 700 },
		);
		const parsed = extractJsonObject<InstructionPlanJson>(text);
		if (!parsed?.goal?.trim()) return null;

		const preferred = parsed.preferredChartType?.trim().toLowerCase();
		const preferredChartType =
			preferred && CHART_TYPES.has(preferred as GraphChartType)
				? (preferred as GraphChartType)
				: null;

		const yKeyHints = Array.isArray(parsed.yKeyHints)
			? parsed.yKeyHints.map((s) => String(s).trim()).filter(Boolean).slice(0, 3)
			: [];

		const aggregationRaw = parsed.aggregation?.trim().toLowerCase();
		const aggregation =
			aggregationRaw === "sum" ||
			aggregationRaw === "avg" ||
			aggregationRaw === "count" ||
			aggregationRaw === "none"
				? aggregationRaw
				: null;

		const sortDirectionRaw = parsed.sortDirection?.trim().toLowerCase();
		const sortDirection =
			sortDirectionRaw === "asc" || sortDirectionRaw === "desc" ? sortDirectionRaw : null;

		const limit =
			typeof parsed.limit === "number" && Number.isFinite(parsed.limit)
				? Math.max(1, Math.min(80, Math.round(parsed.limit)))
				: null;

		return {
			goal: parsed.goal.trim(),
			preferredChartType,
			xKeyHint: parsed.xKeyHint?.trim() || null,
			yKeyHints,
			categoryHint: parsed.categoryHint?.trim() || null,
			valueHint: parsed.valueHint?.trim() || null,
			filters: Array.isArray(parsed.filters)
				? parsed.filters.map((f) => String(f).trim()).filter(Boolean).slice(0, 5)
				: [],
			sortBy: parsed.sortBy?.trim() || null,
			sortDirection,
			limit,
			aggregation,
			titleHint: parsed.titleHint?.trim() || null,
			notes: parsed.notes?.trim() || "",
			interpretedBy: "agent",
		};
	} catch {
		return null;
	}
}

async function agentExplainGraph(
	plot: GraphPlotResult,
	prompt?: string,
	plan?: GraphInstructionPlan | null,
): Promise<GraphExplanation | null> {
	const stats = seriesStats(plot);
	try {
		const { text } = await completeOpenRouterChat(
			[
				{
					role: "system",
					content: `You are Agent 3: Insight Analyst for research charts.
Explain what the chart shows in plain language for educators and researchers.
If user instructions / an instruction plan are provided, explicitly judge whether the chart answers that request.
Return ONLY JSON with keys:
- summary: 1-2 sentences describing what the graph shows
- insights: array of 3-5 short factual observations from the data
- takeaways: 1-2 sentences on what a researcher should notice next
- caveats: 1 short sentence about limitations
Be concrete. Use the provided numbers. Do not invent columns or values not present.`,
				},
				{
					role: "user",
					content: JSON.stringify({
						datasetTitle: plot.datasetTitle,
						chartType: plot.chartType,
						title: plot.title,
						userRequest: prompt?.trim() || null,
						instructionPlan: plan ?? null,
						xKey: plot.xKey,
						yKeys: plot.yKeys,
						nameKey: plot.nameKey,
						valueKey: plot.valueKey,
						rowCount: plot.rowCount,
						plottedPoints: plot.series.length,
						stats,
						samplePoints: plot.series.slice(0, 12),
					}),
				},
			],
			{ model: getOpenRouterFastModel(), maxTokens: 800 },
		);
		const parsed = extractJsonObject<AgentExplanationJson>(text);
		if (!parsed?.summary?.trim()) return null;
		const insights = Array.isArray(parsed.insights)
			? parsed.insights.map((s) => String(s).trim()).filter(Boolean).slice(0, 6)
			: [];
		return {
			summary: parsed.summary.trim(),
			insights: insights.length > 0 ? insights : heuristicExplanation(plot, prompt).insights,
			takeaways: parsed.takeaways?.trim() || heuristicExplanation(plot, prompt).takeaways,
			caveats: parsed.caveats?.trim() || heuristicExplanation(plot, prompt).caveats,
			generatedBy: "agent",
		};
	} catch {
		return null;
	}
}

async function agentMapping(
	chartType: GraphChartType,
	columns: string[],
	sampleRows: Record<string, string>[],
	datasetTitle: string,
	prompt?: string,
	plan?: GraphInstructionPlan | null,
): Promise<AgentMapping | null> {
	try {
		const { text } = await completeOpenRouterChat(
			[
				{
					role: "system",
					content: `You are Agent 2: Column Mapping Agent for a ${chartType} chart.
Given dataset columns, sample rows, and an optional instruction plan, choose the best fields.
Return ONLY JSON with keys: title, description, xKey, yKeys (1-3 numeric columns), nameKey, valueKey, sortBy, sortDirection (asc|desc), limit.
For pie charts, set nameKey (category) and valueKey (numeric). For others, set xKey and yKeys.
Honor the instruction plan whenever columns exist. Use only provided column names.`,
				},
				{
					role: "user",
					content: JSON.stringify({
						datasetTitle,
						chartType,
						userRequest: prompt?.trim() || "Choose the most informative plot.",
						instructionPlan: plan ?? null,
						columns,
						sampleRows: sampleRows.slice(0, 8),
					}),
				},
			],
			{ model: getOpenRouterFastModel(), maxTokens: 650 },
		);
		return extractJsonObject<AgentMapping>(text);
	} catch {
		return null;
	}
}

function applyInstructionPlanToMapping(
	mapping: AgentMapping | null,
	plan: GraphInstructionPlan | null | undefined,
	columns: string[],
	chartType: GraphChartType,
): AgentMapping | null {
	if (!plan) return mapping;
	const next: AgentMapping = { ...(mapping ?? {}) };

	if (plan.titleHint?.trim()) next.title = plan.titleHint.trim();
	if (plan.goal?.trim() && !next.description) {
		next.description = `Followed instructions: ${plan.goal.trim()}`;
	}

	if (chartType === "pie") {
		const cat = resolveColumnHint(plan.categoryHint || plan.xKeyHint, columns);
		const val = resolveColumnHint(plan.valueHint || plan.yKeyHints?.[0], columns);
		if (cat) next.nameKey = cat;
		if (val) next.valueKey = val;
	} else {
		const x = resolveColumnHint(plan.xKeyHint || plan.categoryHint, columns);
		const ys = (plan.yKeyHints ?? [])
			.map((h) => resolveColumnHint(h, columns))
			.filter((c): c is string => Boolean(c))
			.slice(0, 3);
		const valueFallback = resolveColumnHint(plan.valueHint, columns);
		if (x) next.xKey = x;
		if (ys.length > 0) next.yKeys = ys;
		else if (valueFallback) next.yKeys = [valueFallback];
	}

	const sortBy = resolveColumnHint(plan.sortBy, columns);
	if (sortBy) next.sortBy = sortBy;
	if (plan.sortDirection) next.sortDirection = plan.sortDirection;
	if (plan.limit) next.limit = plan.limit;

	return next;
}

function applySeriesTransforms(
	series: Array<Record<string, string | number>>,
	mapping: AgentMapping | null | undefined,
	chartType: GraphChartType,
	xKey: string,
	yKeys: string[],
): Array<Record<string, string | number>> {
	let next = [...series];
	const sortBy =
		mapping?.sortBy && (yKeys.includes(mapping.sortBy) || mapping.sortBy === xKey)
			? mapping.sortBy
			: yKeys[0];
	const direction =
		mapping?.sortDirection === "asc"
			? "asc"
			: mapping?.sortDirection === "desc"
				? "desc"
				: null;

	if (direction && sortBy) {
		next.sort((a, b) => {
			const av = a[sortBy];
			const bv = b[sortBy];
			const an = typeof av === "number" ? av : Number(av);
			const bn = typeof bv === "number" ? bv : Number(bv);
			if (Number.isFinite(an) && Number.isFinite(bn)) {
				return direction === "asc" ? an - bn : bn - an;
			}
			return direction === "asc"
				? String(av ?? "").localeCompare(String(bv ?? ""))
				: String(bv ?? "").localeCompare(String(av ?? ""));
		});
	}

	const limit =
		typeof mapping?.limit === "number" && Number.isFinite(mapping.limit)
			? Math.max(1, Math.min(chartType === "pie" ? 24 : 80, Math.round(mapping.limit)))
			: null;
	if (limit) next = next.slice(0, limit);
	return next;
}

function applyAgentMapping(
	base: GraphPlotResult,
	mapping: AgentMapping,
	rows: Record<string, string>[],
): GraphPlotResult {
	const columns = new Set(base.columns);
	const xKey = mapping.xKey && columns.has(mapping.xKey) ? mapping.xKey : base.xKey;
	let yKeys = (mapping.yKeys ?? [])
		.filter((k) => typeof k === "string" && columns.has(k))
		.slice(0, 3);
	if (yKeys.length === 0) yKeys = base.yKeys;

	const nameKey =
		mapping.nameKey && columns.has(mapping.nameKey)
			? mapping.nameKey
			: base.nameKey || xKey;
	const valueKey =
		mapping.valueKey && columns.has(mapping.valueKey)
			? mapping.valueKey
			: base.valueKey || yKeys[0];

	const keysNeeded =
		base.chartType === "pie" ? [nameKey!, valueKey!] : [xKey, ...yKeys];

	let series = rows.slice(0, base.chartType === "pie" ? 24 : 80).map((row) => {
		const point: Record<string, string | number> = {};
		for (const key of keysNeeded) {
			const raw = row[key] ?? "";
			point[key] = isNumericValue(raw) ? toNumber(raw) : raw;
		}
		return point;
	});

	series = applySeriesTransforms(series, mapping, base.chartType, xKey, yKeys);

	return {
		...base,
		title: mapping.title?.trim() || base.title,
		description: mapping.description?.trim() || base.description,
		xKey,
		yKeys,
		nameKey: base.chartType === "pie" ? nameKey : undefined,
		valueKey: base.chartType === "pie" ? valueKey : undefined,
		series,
		usedAgent: true,
	};
}

export async function plotDatasetGraph(
	datasetId: string,
	userId: string | null | undefined,
	input: { chartType?: string; prompt?: string },
): Promise<GraphPlotResult> {
	const uid = requireUserId(userId);
	if (!Types.ObjectId.isValid(datasetId)) throw new Error("Dataset not found.");

	let chartType = (input.chartType?.trim().toLowerCase() || "bar") as GraphChartType;
	if (!CHART_TYPES.has(chartType)) {
		throw new Error("Unsupported chart type. Use bar, line, area, pie, or scatter.");
	}

	const doc = await ResearchDatasetModel.findOne({
		_id: datasetId,
		userId: new Types.ObjectId(uid),
	});
	if (!doc) throw new Error("Dataset not found.");
	if (!doc.fileData?.trim()) {
		throw new Error("This dataset has no uploaded file. Upload a CSV, TSV, or JSON file first.");
	}

	const raw = decodeDataUrl(doc.fileData);
	const format = (doc.format || doc.fileName.split(".").pop() || "").toLowerCase();
	const parsed =
		format === "json" || raw.trim().startsWith("[") || raw.trim().startsWith("{")
			? parseJsonDataset(raw)
			: parseTabularText(raw);

	const userPrompt = input.prompt?.trim() || "";
	const agentSteps: GraphAgentStep[] = [];

	let instructionPlan: GraphInstructionPlan | null = null;
	if (userPrompt) {
		const agentPlan = await agentInterpretInstructions(
			userPrompt,
			chartType,
			parsed.columns,
			parsed.rows,
			doc.title,
		);
		instructionPlan = agentPlan ?? heuristicInstructionPlan(userPrompt, chartType, parsed.columns);
		agentSteps.push({
			id: "instruction-analyst",
			agent: "Instruction Analyst",
			status: agentPlan ? "ok" : "fallback",
			detail: agentPlan
				? agentPlan.notes || agentPlan.goal
				: "LLM unavailable — used heuristic instruction parsing.",
		});

		if (
			instructionPlan.preferredChartType &&
			CHART_TYPES.has(instructionPlan.preferredChartType) &&
			instructionPlan.preferredChartType !== chartType
		) {
			chartType = instructionPlan.preferredChartType;
			agentSteps.push({
				id: "chart-override",
				agent: "Instruction Analyst",
				status: "ok",
				detail: `Switched chart type to ${chartType} based on instructions.`,
			});
		}
	} else {
		agentSteps.push({
			id: "instruction-analyst",
			agent: "Instruction Analyst",
			status: "skipped",
			detail: "No instructions provided — using selected chart type defaults.",
		});
	}

	const base = heuristicPlot(chartType, parsed.columns, parsed.rows, doc.title, userPrompt || undefined);

	const rawMapping = await agentMapping(
		chartType,
		parsed.columns,
		parsed.rows,
		doc.title,
		userPrompt || undefined,
		instructionPlan,
	);
	const mapping = applyInstructionPlanToMapping(
		rawMapping,
		instructionPlan,
		parsed.columns,
		chartType,
	);

	agentSteps.push({
		id: "column-mapper",
		agent: "Column Mapping Agent",
		status: rawMapping ? "ok" : mapping ? "fallback" : "fallback",
		detail: rawMapping
			? `Mapped ${chartType === "pie" ? `${mapping?.nameKey} → ${mapping?.valueKey}` : `${mapping?.xKey ?? base.xKey} vs ${(mapping?.yKeys ?? base.yKeys).join(", ")}`}.`
			: mapping
				? "LLM mapping failed — applied instruction column hints where possible."
				: "Used heuristic column detection.",
	});

	const plot = mapping ? applyAgentMapping(base, mapping, parsed.rows) : base;

	const agentExplanation = await agentExplainGraph(plot, userPrompt || undefined, instructionPlan);
	const explanation = agentExplanation ?? heuristicExplanation(plot, userPrompt || undefined);
	agentSteps.push({
		id: "insight-analyst",
		agent: "Insight Analyst",
		status: agentExplanation ? "ok" : "fallback",
		detail: agentExplanation
			? "Generated research-facing explanation from plotted values."
			: "Used statistical heuristic explanation.",
	});

	return {
		...plot,
		explanation,
		usedAgent:
			plot.usedAgent ||
			explanation.generatedBy === "agent" ||
			instructionPlan?.interpretedBy === "agent",
		userPrompt: userPrompt || undefined,
		instructionPlan,
		agentSteps,
	};
}

function escapeMarkdownCell(value: string | number): string {
	return String(value).replace(/\|/g, "\\|").replace(/\n+/g, " ").trim();
}

function plotToMarkdownTable(plot: GraphPlotResult): string {
	const keys = [plot.xKey, ...plot.yKeys].filter(Boolean);
	if (!keys.length || !plot.series.length) return "";
	const header = `| ${keys.map(escapeMarkdownCell).join(" | ")} |`;
	const divider = `| ${keys.map(() => "---").join(" | ")} |`;
	const rows = plot.series.slice(0, 30).map((row) => {
		return `| ${keys.map((key) => escapeMarkdownCell(row[key] ?? "")).join(" | ")} |`;
	});
	return [header, divider, ...rows].join("\n");
}

function plotToChartBlock(plot: GraphPlotResult): string {
	const payload = {
		type: plot.chartType,
		kind: "evidence",
		title: plot.title,
		caption: `Generated from the selected dataset “${plot.datasetTitle}”.`,
		xKey: plot.xKey,
		yKeys: plot.yKeys,
		data: plot.series.slice(0, 30),
	};
	return ["```research-chart", JSON.stringify(payload, null, 2), "```"].join("\n");
}

type NotebookColumn = { id?: string; name?: string; type?: string };
type NotebookRow = { cells?: Record<string, string | number | null> };
type NotebookDataset = {
	name?: string;
	sourceFileName?: string;
	columns?: NotebookColumn[];
	rows?: NotebookRow[];
};
type NotebookAsset = {
	name?: string;
	mime?: string;
	dataUrl?: string;
};

const MAX_NOTEBOOK_FIGURES = 6;
const MAX_FIGURE_DATA_URL_CHARS = 350_000; // ~260KB binary

const MAX_NOTEBOOK_TABLE_ROWS = 5;

function notebookDatasetToTable(dataset: NotebookDataset): string {
	const columns = (dataset.columns ?? []).filter((c) => c.id && c.name);
	const rows = dataset.rows ?? [];
	if (!columns.length || !rows.length) return "";
	const header = `| ${columns.map((c) => escapeMarkdownCell(c.name ?? "")).join(" | ")} |`;
	const divider = `| ${columns.map(() => "---").join(" | ")} |`;
	const sample = rows.slice(0, MAX_NOTEBOOK_TABLE_ROWS);
	const body = sample.map((row) => {
		const cells = row.cells ?? {};
		return `| ${columns
			.map((c) => {
				const v = cells[c.id!];
				return escapeMarkdownCell(v == null ? "" : v);
			})
			.join(" | ")} |`;
	});
	return [header, divider, ...body].join("\n");
}

function notebookDatasetToChartBlock(dataset: NotebookDataset): string | null {
	const columns = (dataset.columns ?? []).filter((c) => c.id && c.name);
	const rows = dataset.rows ?? [];
	if (columns.length < 1 || rows.length < 2) return null;
	const numericCols = columns.filter((c) => c.type === "number");
	const categoryCol =
		columns.find((c) => c.type !== "number") ?? columns[0];
	const valueCol = numericCols[0] ?? columns.find((c) => c.id !== categoryCol?.id);
	if (!categoryCol?.id || !valueCol?.id) return null;

	const data: Array<Record<string, string | number>> = [];
	for (const row of rows) {
		if (data.length >= 30) break;
		const cells = row.cells ?? {};
		const label = cells[categoryCol.id];
		const raw = cells[valueCol.id];
		const num = typeof raw === "number" ? raw : Number(raw);
		if (label == null || label === "" || !Number.isFinite(num)) continue;
		data.push({
			[categoryCol.name!]: String(label),
			[valueCol.name!]: num,
		});
	}
	if (data.length < 2) return null;

	const title = dataset.name?.trim() || dataset.sourceFileName || "Research note dataset";
	const payload = {
		type: "bar" as const,
		kind: "evidence" as const,
		title,
		caption: `From research note dataset “${title}”.`,
		xKey: categoryCol.name!,
		yKeys: [valueCol.name!],
		data,
	};
	return ["```research-chart", JSON.stringify(payload, null, 2), "```"].join("\n");
}

function notebookAssetToFigureBlock(asset: NotebookAsset, index: number): string | null {
	const dataUrl = asset.dataUrl?.trim() ?? "";
	const mime = (asset.mime ?? "").toLowerCase();
	if (!dataUrl.startsWith("data:image/")) return null;
	if (!mime.startsWith("image/") && !/^data:image\//i.test(dataUrl)) return null;
	if (dataUrl.length > MAX_FIGURE_DATA_URL_CHARS) return null;
	const title = asset.name?.trim() || `Figure ${index + 1}`;
	const payload = {
		type: "research-figure",
		title,
		caption: `From research note Figures: ${title}`,
		mime: mime.startsWith("image/") ? mime : "image/png",
		dataUrl,
	};
	return ["```research-figure", JSON.stringify(payload), "```"].join("\n");
}

async function buildNotebookVisualizationArtifacts(
	userId: string,
	projectIds: string[],
	topic: string,
): Promise<{ promptArtifacts: string; figureAppendix: string; hasSavedFigures: boolean }> {
	const owner = new Types.ObjectId(userId);
	const ids = projectIds
		.filter((id, index, all) => Types.ObjectId.isValid(id) && all.indexOf(id) === index)
		.slice(0, 3)
		.map((id) => new Types.ObjectId(id));
	if (!ids.length) return { promptArtifacts: "", figureAppendix: "", hasSavedFigures: false };

	const projects = await ResearchProjectModel.find({ _id: { $in: ids }, userId: owner });
	const promptSections: string[] = [];
	const figureBlocks: string[] = [];
	const figureNames: string[] = [];

	for (const project of projects) {
		const notebook = project.notebookData;
		if (!notebook || typeof notebook !== "object") continue;
		const state = notebook as {
			datasets?: NotebookDataset[];
			assets?: NotebookAsset[];
		};
		const datasets = Array.isArray(state.datasets) ? state.datasets : [];
		const assets = Array.isArray(state.assets) ? state.assets : [];
		const hasFigures = assets.some((a) => a?.dataUrl?.startsWith("data:image/"));

		// Tables only — do not invent charts when the user already saved figures.
		for (const dataset of datasets.slice(0, 3)) {
			const title = dataset.name?.trim() || dataset.sourceFileName || "Dataset";
			const table = notebookDatasetToTable(dataset);
			if (!table) continue;
			const totalRows = dataset.rows?.length ?? 0;
			promptSections.push(
				[
					`### Research note table sample: ${title}`,
					`From research note “${project.title}” (topic: ${topic}).`,
					`Show at most ${MAX_NOTEBOOK_TABLE_ROWS} sample rows in Results (dataset has ${totalRows} records). Do not dump the full table.`,
					"Do NOT create a “Data Source and Variables” section.",
					"",
					"**Canonical sample table (≤5 rows — insert exactly as written, only in Results / Analysis)**",
					"",
					table,
				].join("\n"),
			);
		}

		let figureIndex = 0;
		for (const asset of assets) {
			if (figureIndex >= MAX_NOTEBOOK_FIGURES) break;
			const block = notebookAssetToFigureBlock(asset, figureIndex);
			if (!block) continue;
			const title = asset.name?.trim() || `Figure ${figureIndex + 1}`;
			figureNames.push(`Figure ${figureIndex + 1}: ${title}`);
			figureBlocks.push(block);
			figureIndex += 1;
		}

		if (hasFigures && figureNames.length) {
			promptSections.push(
				[
					`### Saved research-note figures (use these — do not invent new images)`,
					`From research note “${project.title}”.`,
					"In Results / Analysis, refer to these figures by name. The actual images are injected automatically after generation.",
					"Do NOT create `research-image`, illustrative `research-chart`, or any new image.",
					"",
					...figureNames.map((n) => `- ${n}`),
				].join("\n"),
			);
		}
	}

	return {
		promptArtifacts: promptSections.join("\n\n").trim(),
		figureAppendix: figureBlocks.join("\n\n").trim(),
		hasSavedFigures: figureBlocks.length > 0,
	};
}

export type PaperVisualizationResult = {
	artifacts: string;
	figureAppendix: string;
	hasSavedFigures: boolean;
};

export async function buildPaperVisualizationArtifacts(
	userId: string | null | undefined,
	input: { datasetIds?: string[]; projectIds?: string[]; topic?: string },
): Promise<PaperVisualizationResult> {
	const uid = requireUserId(userId);
	const datasetIds = (input.datasetIds ?? [])
		.filter((id, index, all) => Types.ObjectId.isValid(id) && all.indexOf(id) === index)
		.slice(0, 3);
	const projectIds = (input.projectIds ?? [])
		.filter((id, index, all) => Types.ObjectId.isValid(id) && all.indexOf(id) === index)
		.slice(0, 3);
	if (!datasetIds.length && !projectIds.length) {
		return { artifacts: "", figureAppendix: "", hasSavedFigures: false };
	}

	const topic = input.topic?.trim() || "research findings";
	const sections: string[] = [];

	// Prefer research-note path: skip slow LLM chart agents when a note is selected.
	if (projectIds.length) {
		const notebook = await buildNotebookVisualizationArtifacts(uid, projectIds, topic);
		return {
			artifacts: notebook.promptArtifacts,
			figureAppendix: notebook.figureAppendix,
			hasSavedFigures: notebook.hasSavedFigures,
		};
	}

	for (const datasetId of datasetIds) {
		try {
			const plot = await plotDatasetGraph(datasetId, uid, {
				chartType: "bar",
				prompt: `Create a research-ready visualization for the topic "${topic}". Prefer the clearest numeric comparison available in this dataset.`,
			});
			const table = plotToMarkdownTable(plot);
			const chart = plotToChartBlock(plot);
			const explanation = [
				plot.explanation.summary,
				...(plot.explanation.insights ?? []).slice(0, 4).map((insight) => `- ${insight}`),
				plot.explanation.takeaways ? `Takeaway: ${plot.explanation.takeaways}` : "",
			]
				.filter(Boolean)
				.join("\n");

			sections.push(
				[
					`### Dataset figure: ${plot.datasetTitle}`,
					plot.description,
					"",
					"**Canonical results table**",
					"",
					table,
					"",
					"**Canonical research chart (insert exactly as written)**",
					"",
					chart,
					"",
					"**Agent explanation**",
					"",
					explanation,
				]
					.filter(Boolean)
					.join("\n"),
			);
		} catch {
			/* Skip datasets that cannot be plotted safely. */
		}
	}

	return {
		artifacts: sections.join("\n\n").trim(),
		figureAppendix: "",
		hasSavedFigures: false,
	};
}
