import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Model } from "mongoose";

import { MessageModel } from "../db/models/Message.js";
import { OutputArtifactModel } from "../db/models/OutputArtifact.js";
import { AiSystemInventoryModel } from "../db/models/AiSystemInventory.js";
import { ApprovalRequestModel } from "../db/models/ApprovalRequest.js";
import { AuditLogModel } from "../db/models/AuditLog.js";
import { ComplianceControlModel } from "../db/models/ComplianceControl.js";
import { GovernanceIncidentModel } from "../db/models/GovernanceIncident.js";
import { GovernancePolicyModel } from "../db/models/GovernancePolicy.js";
import { GovernanceReportModel } from "../db/models/GovernanceReport.js";
import { GovernanceRiskModel } from "../db/models/GovernanceRisk.js";
import { ResearchIdeaSessionModel } from "../db/models/ResearchIdeaSession.js";
import { SavedCoursePlanModel } from "../db/models/SavedCoursePlan.js";
import { SavedResearchModel } from "../db/models/SavedResearch.js";
import { SavedResearchIdeaModel } from "../db/models/SavedResearchIdea.js";
import { SavedResearchOutlineModel } from "../db/models/SavedResearchOutline.js";
import { SessionModel } from "../db/models/Session.js";
import { UserModel } from "../db/models/User.js";
import { getBackendRoot } from "../lib/paths.js";

export type BackupTableInfo = {
	key: string;
	label: string;
	collection: string;
	count: number;
};

export type BackupFileInfo = {
	filename: string;
	size: number;
	createdAt: string;
	tableCount: number | null;
	documentCount: number | null;
};

type BackupModelEntry = {
	key: string;
	label: string;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	model: Model<any>;
};

const BACKUP_MODELS: BackupModelEntry[] = [
	{ key: "users", label: "Users", model: UserModel },
	{ key: "sessions", label: "Sessions", model: SessionModel },
	{ key: "messages", label: "Messages", model: MessageModel },
	{ key: "saved_research", label: "Saved research papers", model: SavedResearchModel },
	{ key: "saved_research_ideas", label: "Saved research ideas", model: SavedResearchIdeaModel },
	{ key: "saved_research_outlines", label: "Saved research outlines", model: SavedResearchOutlineModel },
	{ key: "research_idea_sessions", label: "Research idea sessions", model: ResearchIdeaSessionModel },
	{ key: "saved_course_plans", label: "Saved course plans", model: SavedCoursePlanModel },
	{ key: "output_artifacts", label: "Output artifacts", model: OutputArtifactModel },
	{ key: "governance_policies", label: "Governance policies", model: GovernancePolicyModel },
	{ key: "audit_logs", label: "Audit logs", model: AuditLogModel },
	{ key: "approval_requests", label: "Approval requests", model: ApprovalRequestModel },
	{ key: "governance_reports", label: "Governance reports", model: GovernanceReportModel },
	{ key: "governance_risks", label: "Governance risks", model: GovernanceRiskModel },
	{ key: "compliance_controls", label: "Compliance controls", model: ComplianceControlModel },
	{ key: "governance_incidents", label: "Governance incidents", model: GovernanceIncidentModel },
	{ key: "ai_system_inventory", label: "AI system inventory", model: AiSystemInventoryModel },
];

const BACKUP_FILE_PREFIX = "aula-backup-";
const BACKUP_FILE_SUFFIX = ".json";

function getBackupDir(): string {
	const dir = resolve(getBackendRoot(), "backups");
	mkdirSync(dir, { recursive: true });
	return dir;
}

function serializeValue(value: unknown): unknown {
	if (value === null || value === undefined) return value;
	if (value instanceof Date) return value.toISOString();
	if (Array.isArray(value)) return value.map(serializeValue);
	if (typeof value === "object") {
		const record = value as Record<string, unknown>;
		if (record._bsontype === "ObjectId" && typeof record.toString === "function") {
			return record.toString();
		}
		const next: Record<string, unknown> = {};
		for (const [key, entry] of Object.entries(record)) {
			next[key] = serializeValue(entry);
		}
		return next;
	}
	return value;
}

function parseBackupMetadata(raw: string): { tableCount: number | null; documentCount: number | null } {
	try {
		const parsed = JSON.parse(raw) as {
			tables?: Record<string, unknown[]>;
			counts?: Record<string, number>;
		};
		if (parsed.counts) {
			const documentCount = Object.values(parsed.counts).reduce((sum, count) => sum + count, 0);
			return { tableCount: Object.keys(parsed.counts).length, documentCount };
		}
		if (parsed.tables) {
			const documentCount = Object.values(parsed.tables).reduce(
				(sum, rows) => sum + (Array.isArray(rows) ? rows.length : 0),
				0,
			);
			return { tableCount: Object.keys(parsed.tables).length, documentCount };
		}
	} catch {
		/* ignore invalid metadata */
	}
	return { tableCount: null, documentCount: null };
}

export async function listBackupTables(): Promise<BackupTableInfo[]> {
	const tables: BackupTableInfo[] = [];
	for (const entry of BACKUP_MODELS) {
		const count = await entry.model.countDocuments();
		tables.push({
			key: entry.key,
			label: entry.label,
			collection: entry.model.collection.name,
			count,
		});
	}
	return tables;
}

export function listBackupFiles(): BackupFileInfo[] {
	const dir = getBackupDir();
	const files = readdirSync(dir)
		.filter((name) => name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX))
		.map((filename) => {
			const filepath = resolve(dir, filename);
			const stats = statSync(filepath);
			const preview = readFileSync(filepath, "utf8").slice(0, 200_000);
			const metadata = parseBackupMetadata(preview);
			return {
				filename,
				size: stats.size,
				createdAt: stats.mtime.toISOString(),
				tableCount: metadata.tableCount,
				documentCount: metadata.documentCount,
			};
		})
		.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

	return files;
}

export async function createDatabaseBackup(): Promise<BackupFileInfo> {
	const dir = getBackupDir();
	const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
	const filename = `${BACKUP_FILE_PREFIX}${timestamp}${BACKUP_FILE_SUFFIX}`;
	const filepath = resolve(dir, filename);

	const tables: Record<string, unknown[]> = {};
	const counts: Record<string, number> = {};

	for (const entry of BACKUP_MODELS) {
		const rows = await entry.model.find({}).lean();
		const serialized = rows.map((row) => serializeValue(row));
		tables[entry.key] = serialized;
		counts[entry.key] = serialized.length;
	}

	const payload = {
		version: 1,
		createdAt: new Date().toISOString(),
		app: "GARIL AI",
		counts,
		tables,
	};

	writeFileSync(filepath, JSON.stringify(payload, null, 2), "utf8");

	const stats = statSync(filepath);
	return {
		filename,
		size: stats.size,
		createdAt: stats.mtime.toISOString(),
		tableCount: Object.keys(tables).length,
		documentCount: Object.values(counts).reduce((sum, count) => sum + count, 0),
	};
}

export function getBackupFilePath(filename: string): string {
	const safeName = filename.split(/[/\\]/).pop();
	if (!safeName || !safeName.startsWith(BACKUP_FILE_PREFIX) || !safeName.endsWith(BACKUP_FILE_SUFFIX)) {
		throw new Error("Invalid backup filename.");
	}
	return resolve(getBackupDir(), safeName);
}

export function readBackupFile(filename: string): { content: string; size: number } {
	const filepath = getBackupFilePath(filename);
	if (!statSync(filepath).isFile()) {
		throw new Error("Backup file not found.");
	}
	const content = readFileSync(filepath, "utf8");
	return { content, size: statSync(filepath).size };
}
