export const QUESTIONNAIRE_ITEM_KINDS = [
	"open",
	"yes_no",
	"multiple_choice",
	"likert",
	"numeric",
] as const;

export type QuestionnaireItemKind = (typeof QUESTIONNAIRE_ITEM_KINDS)[number];

export type QuestionnaireItem = {
	id: string;
	prompt: string;
	kind: QuestionnaireItemKind;
	options: string[];
	scaleMin: number;
	scaleMax: number;
	column: string;
};

const MAX_ITEMS = 80;
const MAX_PROMPT = 500;
const MAX_OPTIONS = 20;
const MAX_OPTION = 200;
const MAX_TITLE = 200;
const MAX_TEXT = 4_000;

function asString(value: unknown, max: number): string {
	if (typeof value !== "string") return "";
	return value.trim().slice(0, max);
}

function asId(value: unknown): string {
	if (typeof value !== "string") return "";
	return value.trim().slice(0, 64);
}

function newItemId(): string {
	if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
	return `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export function isQuestionnaireItemKind(value: unknown): value is QuestionnaireItemKind {
	return typeof value === "string" && (QUESTIONNAIRE_ITEM_KINDS as readonly string[]).includes(value);
}

export function sanitizeQuestionnaireItems(raw: unknown): QuestionnaireItem[] {
	if (!Array.isArray(raw)) return [];
	const items: QuestionnaireItem[] = [];
	for (const row of raw.slice(0, MAX_ITEMS)) {
		if (!row || typeof row !== "object") continue;
		const item = row as Record<string, unknown>;
		const prompt = asString(item.prompt, MAX_PROMPT);
		if (!prompt) continue;
		const kind: QuestionnaireItemKind = isQuestionnaireItemKind(item.kind) ? item.kind : "open";
		const options = Array.isArray(item.options)
			? item.options.map((opt) => asString(opt, MAX_OPTION)).filter(Boolean).slice(0, MAX_OPTIONS)
			: [];
		let scaleMin = Number(item.scaleMin);
		let scaleMax = Number(item.scaleMax);
		if (!Number.isFinite(scaleMin)) scaleMin = 1;
		if (!Number.isFinite(scaleMax)) scaleMax = kind === "likert" ? 5 : 10;
		if (scaleMin > scaleMax) [scaleMin, scaleMax] = [scaleMax, scaleMin];
		items.push({
			id: asId(item.id) || newItemId(),
			prompt,
			kind,
			options,
			scaleMin: Math.round(scaleMin),
			scaleMax: Math.round(scaleMax),
			column: asString(item.column, 200),
		});
	}
	return items;
}

export function guessItemKind(values: string[]): QuestionnaireItemKind {
	const nonempty = values.map((v) => v.trim()).filter(Boolean);
	if (nonempty.length === 0) return "open";
	const lower = nonempty.map((v) => v.toLowerCase());
	const yesNo = lower.every((v) => /^(yes|no|y|n|true|false|1|0)$/i.test(v));
	if (yesNo) return "yes_no";
	const numeric = nonempty.every((v) => /^-?\d+(\.\d+)?$/.test(v));
	if (numeric) {
		const nums = nonempty.map(Number);
		const min = Math.min(...nums);
		const max = Math.max(...nums);
		if (min >= 1 && max <= 7 && nums.every((n) => Number.isInteger(n))) return "likert";
		return "numeric";
	}
	const unique = [...new Set(lower)];
	if (unique.length >= 2 && unique.length <= 12 && unique.length <= Math.max(3, nonempty.length / 2)) {
		return "multiple_choice";
	}
	return "open";
}

export function itemsFromColumns(
	columns: string[],
	sampleByColumn: Record<string, string[]>,
): QuestionnaireItem[] {
	return columns
		.map((column) => {
			const prompt = column.trim();
			if (!prompt) return null;
			const samples = sampleByColumn[column] ?? [];
			const kind = guessItemKind(samples);
			const unique = [...new Set(samples.map((v) => v.trim()).filter(Boolean))].slice(0, MAX_OPTIONS);
			return {
				id: newItemId(),
				prompt,
				kind,
				options: kind === "multiple_choice" || kind === "yes_no" ? unique : [],
				scaleMin: 1,
				scaleMax: kind === "likert" ? 5 : 10,
				column,
			} satisfies QuestionnaireItem;
		})
		.filter((item): item is QuestionnaireItem => Boolean(item))
		.slice(0, MAX_ITEMS);
}

export function clipMeta(value: unknown, max = MAX_TEXT): string {
	return asString(value, max);
}

export function clipTitle(value: unknown): string {
	return asString(value, MAX_TITLE);
}

export function decodeDataUrlToBuffer(value: string): Buffer {
	const match = value.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
	if (!match) return Buffer.from(value, "base64");
	const payload = match[3] ?? "";
	return match[2] ? Buffer.from(payload, "base64") : Buffer.from(decodeURIComponent(payload), "utf8");
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

export async function parseTabularBuffer(
	fileName: string,
	buffer: Buffer,
): Promise<{ columns: string[]; rows: Record<string, string>[] }> {
	const lower = fileName.toLowerCase();
	if (lower.endsWith(".xlsx")) {
		const ExcelJS = (await import("exceljs")).default;
		const workbook = new ExcelJS.Workbook();
		await workbook.xlsx.load(Uint8Array.from(buffer).buffer);
		const sheet = workbook.worksheets[0];
		if (!sheet) throw new Error("Workbook has no sheets.");
		const matrix: string[][] = [];
		sheet.eachRow({ includeEmpty: false }, (row) => {
			const values = Array.isArray(row.values) ? row.values.slice(1) : [];
			matrix.push(values.map((value) => String(value ?? "").trim()));
		});
		if (matrix.length < 2) throw new Error("File needs a header row and at least one response row.");
		const columns = uniqueColumns(matrix[0].map((c, i) => c || `col_${i + 1}`));
		const rows: Record<string, string>[] = [];
		for (const cells of matrix.slice(1)) {
			if (cells.every((c) => !c.trim())) continue;
			const row: Record<string, string> = {};
			columns.forEach((col, i) => {
				row[col] = (cells[i] ?? "").trim();
			});
			rows.push(row);
		}
		if (rows.length === 0) throw new Error("No response rows found.");
		return { columns, rows };
	}
	if (lower.endsWith(".xls")) {
		throw new Error("Legacy .xls is not supported. Save as CSV or .xlsx.");
	}
	const raw = buffer.toString("utf8").replace(/^\uFEFF/, "");
	const lines = raw
		.split(/\r?\n/)
		.map((l) => l.trimEnd())
		.filter((l) => l.trim().length > 0);
	if (lines.length < 2) throw new Error("File needs a header row and at least one response row.");
	const delimiter = lines[0].includes("\t") && !lines[0].includes(",") ? "\t" : ",";
	const headerCells =
		delimiter === "\t" ? lines[0].split("\t").map((c) => c.trim()) : parseCsvLine(lines[0]);
	const columns = uniqueColumns(headerCells.map((c, i) => c || `col_${i + 1}`));
	const rows: Record<string, string>[] = [];
	for (const line of lines.slice(1)) {
		const cells = delimiter === "\t" ? line.split("\t") : parseCsvLine(line);
		if (cells.every((c) => !c.trim())) continue;
		const row: Record<string, string> = {};
		columns.forEach((col, i) => {
			row[col] = (cells[i] ?? "").trim();
		});
		rows.push(row);
	}
	if (rows.length === 0) throw new Error("No response rows found.");
	return { columns, rows };
}

function uniqueColumns(columns: string[]): string[] {
	const seen = new Map<string, number>();
	return columns.map((name) => {
		const count = (seen.get(name) ?? 0) + 1;
		seen.set(name, count);
		return count > 1 ? `${name}_${count}` : name;
	});
}

export function sampleByColumn(
	columns: string[],
	rows: Record<string, string>[],
	limit = 40,
): Record<string, string[]> {
	const out: Record<string, string[]> = {};
	for (const col of columns) {
		out[col] = rows
			.slice(0, limit)
			.map((row) => row[col] ?? "")
			.filter(Boolean);
	}
	return out;
}
