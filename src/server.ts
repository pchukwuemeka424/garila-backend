import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";

import { connectMongo, disconnectMongo } from "./db/connect.js";
import { extractBearerToken, verifyAuthToken } from "./lib/auth-token.js";
import { createAppContext } from "./lib/app-context.js";
import { getRepoRoot } from "./lib/paths.js";
import { ensureSupportedNodeVersion } from "./system/node-version.js";
import { listOutputs } from "./server/outputs.js";
import { ChatService } from "./services/chat.service.js";
import { getUserById, loginUser, registerLecturer, registerStudent } from "./services/auth.service.js";
import {
	createUser,
	deleteUser,
	getDashboardStats,
	listRecentSessions,
	listUsers,
	updateUser,
} from "./services/dashboard.service.js";
import {
	deleteAllSavedResearch,
	deleteSavedResearch,
	getOutputArtifactContentOrRead,
	getSavedResearchById,
	listOutputArtifacts,
	listSavedResearch,
	saveResearchPaper,
	syncOutputArtifacts,
	updateSavedResearchById,
} from "./services/research.service.js";
import { listWorkflows } from "./services/workflows.js";
import { fetchPapersForQuery } from "./services/alphaxiv.service.js";
import { generateResearchOutline } from "./services/outline.service.js";
import { generateResearchIdeas } from "./services/research-ideas.service.js";
import {
	assertStudentHasTokenBalance,
	deductStudentTokens,
} from "./services/student-token.service.js";
import { generateCoursePresentation } from "./services/lesson-presentation.service.js";
import { generateCourseOutline } from "./services/lesson-planner.service.js";
import {
	deleteSavedCoursePlan,
	getSavedCoursePlan,
	listSavedCoursePlans,
	saveCoursePlan,
} from "./services/lesson-planner-save.service.js";
import {
	deleteAllSavedResearchIdeas,
	deleteSavedResearchIdea,
	listSavedResearchIdeas,
	saveResearchIdea,
	updateResearchIdeaStatus,
} from "./services/saved-research-idea.service.js";
import {
	deleteResearchIdeaSession,
	listResearchIdeaSessions,
	saveResearchIdeaSession,
} from "./services/research-session.service.js";
import {
	deleteSavedResearchOutline,
	listSavedResearchOutlines,
	saveResearchOutlineRecord,
} from "./services/saved-research-outline.service.js";
import {
	createDataset,
	createDocument,
	createNote,
	createProject,
	createReference,
	deleteDataset,
	deleteDocument,
	deleteNote,
	deleteProject,
	deleteReference,
	getDataset,
	getDatasetFile,
	getDocumentFile,
	getNotebookData,
	getOrCreateProject,
	getProject,
	getWorkspaceBundle,
	listActivity,
	listDatasets,
	listDocuments,
	listNotes,
	listProjects,
	listReferences,
	saveNotebookData,
	updateNote,
	updateProject,
} from "./services/research-assets.service.js";
import { buildPaperVisualizationArtifacts, plotDatasetGraph } from "./services/research-graph.service.js";
import {
	buildResearchSourceContext,
	type ResearchSourceSelection,
} from "./services/research-source-context.service.js";
import {
	adminDeleteLecture,
	getLectureAdminStats,
	listAllLectures,
} from "./services/admin-lessons.service.js";
import {
	deleteAdminSession,
	getAdminSession,
	stopAdminSession,
} from "./services/admin-sessions.service.js";
import {
	getTokenAdminStats,
	listUsersTokenQuotas,
	bulkResetUserTokens,
	resetUserTokens,
	setUserTokensUsed,
} from "./services/admin-tokens.service.js";
import {
	bulkDeleteUsers,
	bulkUpdateUserStatus,
	createUser as adminCreateUser,
	deleteUser as adminDeleteUser,
	getDashboardStats as adminGetDashboardStats,
	listConsoleAdmins as adminListConsoleAdmins,
	listRecentSessions as adminListRecentSessions,
	listRecentSessionTopics as adminListRecentSessionTopics,
	listUsers as adminListUsers,
	resetUserPassword,
	updateUser as adminUpdateUser,
} from "./services/admin-users.service.js";
import {
	listUniversities as adminListUniversities,
	onboardUniversity,
	updateUniversity,
} from "./services/admin-universities.service.js";
import {
	AdminRequiredError,
	requireAdmin,
	requireAdminScope,
	requireSuperAdmin,
} from "./lib/require-admin.js";
import {
	createDatabaseBackup,
	listBackupFiles,
	listBackupTables,
	readBackupFile,
} from "./services/admin-backup.service.js";
import { getUsageAnalytics } from "./services/admin-analytics.service.js";
import {
	flagAuditLog,
	getAuditAlertStats,
	listAuditLogs,
	normalizeAuditDefaults,
	recordAuditEvent,
} from "./services/admin-audit.service.js";
import {
	createApproval,
	getApprovalStats,
	listApprovals,
	normalizeApprovalDefaults,
	reviewApproval,
} from "./services/admin-approvals.service.js";
import { getGovernanceDashboard } from "./services/admin-governance.service.js";
import {
	createPolicy,
	deletePolicy,
	evaluatePolicy,
	getPolicyStats,
	listPolicies,
	normalizePolicyDefaults,
	updatePolicy,
} from "./services/admin-policy.service.js";
import {
	generateGovernanceReport,
	getGovernanceReport,
	listGovernanceReports,
	normalizeGovernanceReportDefaults,
} from "./services/admin-reports.service.js";
import {
	createRisk,
	deleteRisk,
	getRiskStats,
	listRisks,
	normalizeRiskDefaults,
	updateRisk,
} from "./services/admin-risk.service.js";
import {
	createComplianceControl,
	getComplianceStats,
	listComplianceControls,
	normalizeComplianceDefaults,
	updateComplianceControl,
	deleteComplianceControl,
} from "./services/admin-compliance.service.js";
import {
	createIncident,
	getIncidentStats,
	listIncidents,
	normalizeIncidentDefaults,
	updateIncident,
} from "./services/admin-incidents.service.js";
import {
	createAlert,
	getAlertStats,
	listAlerts,
	normalizeAlertDefaults,
	updateAlert,
} from "./services/admin-alerts.service.js";
import { getPlatformOverview } from "./services/admin-overview.service.js";
import {
	createContributionStatement,
	getContributionStats,
	listContributionStatements,
	normalizeContributionDefaults,
	verifyContributionStatement,
} from "./services/admin-contributions.service.js";
import {
	createProvenanceRecord,
	getProvenanceStats,
	listProvenanceRecords,
	normalizeProvenanceDefaults,
	reviewProvenanceRecord,
} from "./services/admin-provenance.service.js";
import {
	createPrivacySetting,
	deletePrivacySetting,
	getPrivacyStats,
	listPrivacySettings,
	normalizePrivacyDefaults,
	updatePrivacySetting,
} from "./services/admin-privacy.service.js";
import {
	createDeletionRequest,
	createRetentionPolicy,
	deleteRetentionPolicy,
	getRetentionStats,
	listDeletionRequests,
	listRetentionPolicies,
	normalizeRetentionDefaults,
	updateDeletionRequest,
	updateRetentionPolicy,
} from "./services/admin-retention.service.js";
import {
	createAiSystem,
	deleteAiSystem,
	ensureDefaultAiSystems,
	getAiSystemStats,
	listAiSystems,
	normalizeInventoryDefaults,
	updateAiSystem,
} from "./services/admin-inventory.service.js";
import { cleanupSeededGovernanceMocks } from "./services/admin-governance-cleanup.service.js";
import { ensureDefaultAdmin } from "./services/bootstrap-admin.service.js";
import { handleGenerate as handleResearchNoteGenerate } from "./services/research-note-ai/handler.js";
import { UserModel } from "./db/models/User.js";

async function resolveUserId(authorization?: string): Promise<string | null> {
	const token = extractBearerToken(authorization);
	if (!token) return null;
	const payload = verifyAuthToken(token);
	return payload?.sub ?? null;
}

function resolveUserIdFromWsUrl(urlPath: string | undefined): string | null {
	if (!urlPath) return null;
	try {
		const url = new URL(urlPath, "http://localhost");
		const token = url.searchParams.get("token");
		if (!token) return null;
		const payload = verifyAuthToken(token);
		return payload?.sub ?? null;
	} catch {
		return null;
	}
}

function resolveStaticRoot(repoRoot: string): string | null {
	const candidates = [
		resolve(repoRoot, "out"),
		resolve(repoRoot, "dist"),
	];
	for (const candidate of candidates) {
		if (existsSync(join(candidate, "index.html"))) {
			return candidate;
		}
	}
	return null;
}

function resolveStaticHtml(staticRoot: string, urlPath: string): string | null {
	const pathname = urlPath.split("?")[0]?.split("#")[0] ?? "/";
	const normalized =
		pathname.length > 1 && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;

	const candidates =
		normalized === "/"
			? [join(staticRoot, "index.html")]
			: [
					join(staticRoot, normalized.slice(1), "index.html"),
					join(staticRoot, `${normalized.slice(1)}.html`),
				];

	for (const candidate of candidates) {
		if (existsSync(candidate) && statSync(candidate).isFile()) {
			return candidate;
		}
	}
	return null;
}

export async function startServer(port: number): Promise<void> {
	ensureSupportedNodeVersion();
	await connectMongo();
	await ensureDefaultAdmin();
	await cleanupSeededGovernanceMocks();
	await ensureDefaultAiSystems();
	await normalizeContributionDefaults();
	await normalizeProvenanceDefaults();
	await normalizeIncidentDefaults();
	await normalizeAlertDefaults();
	await normalizeAuditDefaults();
	await normalizePolicyDefaults();
	await normalizeRiskDefaults();
	await normalizeComplianceDefaults();
	await normalizeInventoryDefaults();
	await normalizePrivacyDefaults();
	await normalizeRetentionDefaults();
	await normalizeGovernanceReportDefaults();
	await normalizeApprovalDefaults();

	const ctx = createAppContext();
	const chat = new ChatService(ctx);
	const repoRoot = getRepoRoot();
	const staticRoot = resolveStaticRoot(repoRoot);
	const workflows = listWorkflows(ctx.backendRoot);

	const app = Fastify({ logger: false });

	await app.register(cors, {
		origin: true,
		methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
		allowedHeaders: ["Content-Type", "Authorization"],
	});
	await app.register(websocket);

	if (staticRoot) {
		await app.register(fastifyStatic, {
			root: staticRoot,
			prefix: "/",
			decorateReply: false,
		});
	}

	app.get("/api/health", async () => ({ ok: true, version: ctx.version }));

	app.post("/api/auth/register", async (request, reply) => {
		const body = request.body as {
			name?: string;
			email?: string;
			password?: string;
			department?: string;
			institution?: string;
			catalogueId?: string;
		};
		if (!body.name?.trim() || !body.email?.trim() || !body.password || !body.department?.trim()) {
			return reply.code(400).send({ error: "Name, email, password, and department are required." });
		}
		try {
			const result = await registerLecturer({
				name: body.name,
				email: body.email,
				password: body.password,
				department: body.department,
				institution: body.institution,
				catalogueId: body.catalogueId,
			});
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/auth/register-student", async (request, reply) => {
		const body = request.body as {
			name?: string;
			email?: string;
			password?: string;
			department?: string;
			institution?: string;
			catalogueId?: string;
		};
		if (!body.name?.trim() || !body.email?.trim() || !body.password || !body.department?.trim()) {
			return reply.code(400).send({ error: "Name, email, password, and program are required." });
		}
		try {
			const result = await registerStudent({
				name: body.name,
				email: body.email,
				password: body.password,
				department: body.department,
				institution: body.institution,
				catalogueId: body.catalogueId,
			});
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/auth/login", async (request, reply) => {
		const body = request.body as { email?: string; password?: string };
		if (!body.email?.trim() || !body.password) {
			return reply.code(400).send({ error: "Email and password are required." });
		}
		try {
			const result = await loginUser({ email: body.email, password: body.password });
			return result;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(401).send({ error: message });
		}
	});

	app.get("/api/auth/me", async (request, reply) => {
		const token = extractBearerToken(request.headers.authorization);
		if (!token) return reply.code(401).send({ error: "Authentication required." });

		const payload = verifyAuthToken(token);
		if (!payload) return reply.code(401).send({ error: "Invalid or expired session." });

		const user = await getUserById(payload.sub);
		if (!user) return reply.code(401).send({ error: "User not found." });
		return { user };
	});

	app.get("/api/workflows", async () => ({
		workflows: workflows.map((w) => ({
			name: w.name,
			description: w.description,
			args: w.args,
			command: w.command,
		})),
	}));

	app.get("/api/papers/search", async (request, reply) => {
		const query = (request.query as { q?: string }).q?.trim();
		if (!query) {
			return reply.code(400).send({ error: "Query parameter q is required." });
		}

		try {
			const limitRaw = (request.query as { limit?: string }).limit;
			const limit = limitRaw ? Number.parseInt(limitRaw, 10) : undefined;
			const papers = await fetchPapersForQuery(query, {
				limit: Number.isFinite(limit) ? limit : undefined,
			});
			return { query, papers };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(502).send({ error: message });
		}
	});

	app.post("/api/research/outline", async (request, reply) => {
		const body = request.body as {
			idea?: {
				id?: string;
				title?: string;
				rationale?: string;
				approach?: string;
				type?: string;
				feasibility?: string;
				outline?: string;
				researchQuestions?: string[];
			};
			discipline?: string;
			disciplineLabel?: string;
			topic?: string;
			scope?: string;
			sources?: ResearchSourceSelection;
		};

		if (!body.idea?.title?.trim()) {
			return reply.code(400).send({ error: "idea.title is required." });
		}
		if (!body.disciplineLabel?.trim()) {
			return reply.code(400).send({ error: "disciplineLabel is required." });
		}
		if (!body.topic?.trim()) {
			return reply.code(400).send({ error: "topic is required." });
		}

		const scope = body.scope?.trim();
		const validScopes = new Set(["undergraduate", "masters", "doctoral", "faculty"]);
		if (!scope || !validScopes.has(scope)) {
			return reply.code(400).send({ error: "scope must be undergraduate, masters, doctoral, or faculty." });
		}

		const ideaId = body.idea.id?.trim() || body.idea.title.trim();

		try {
			const userId = await resolveUserId(request.headers.authorization);
			if (userId) {
				await assertStudentHasTokenBalance(userId);
			}
			const sourceContext = await buildResearchSourceContext(userId, body.sources);
			const hasNoteSources = Boolean(
				body.sources?.projectIds?.length ||
					body.sources?.noteIds?.length ||
					body.sources?.documentIds?.length ||
					body.sources?.datasetIds?.length,
			);

			const result = await generateResearchOutline({
				idea: {
					title: body.idea.title.trim(),
					rationale: body.idea.rationale?.trim() ?? "",
					approach: body.idea.approach?.trim() ?? "",
					type: body.idea.type?.trim() ?? "empirical",
					feasibility: body.idea.feasibility?.trim() ?? "medium",
					outline: body.idea.outline?.trim() || undefined,
					researchQuestions: Array.isArray(body.idea.researchQuestions)
						? body.idea.researchQuestions.map((q) => String(q).trim()).filter(Boolean)
						: undefined,
				},
				disciplineLabel: body.disciplineLabel.trim(),
				topic: body.topic.trim(),
				scope: scope as "undergraduate" | "masters" | "doctoral" | "faculty",
				sourceContext,
				fast: hasNoteSources,
			});

			let tokenQuota;
			if (userId && result.usage?.totalTokens) {
				tokenQuota = await deductStudentTokens(userId, result.usage.totalTokens);
			}

			if (userId) {
				await saveResearchOutlineRecord(userId, {
					ideaId,
					ideaTitle: body.idea.title.trim(),
					discipline: body.discipline?.trim() || body.disciplineLabel.trim(),
					topic: body.topic.trim(),
					scope: scope as "undergraduate" | "masters" | "doctoral" | "faculty",
					outline: result.outline,
				});
			}

			return {
				outline: result.outline,
				papers: result.papers,
				...(sourceContext ? { sourceContext } : {}),
				...(tokenQuota ? { tokenQuota } : {}),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(502).send({ error: message });
		}
	});

	app.post("/api/research/ideas/generate", async (request, reply) => {
		const body = request.body as {
			discipline?: string;
			disciplineLabel?: string;
			topic?: string;
			scope?: string;
			sources?: ResearchSourceSelection;
		};

		if (!body.disciplineLabel?.trim()) {
			return reply.code(400).send({ error: "disciplineLabel is required." });
		}
		if (!body.topic?.trim()) {
			return reply.code(400).send({ error: "topic is required." });
		}

		const scope = body.scope?.trim();
		const validScopes = new Set(["undergraduate", "masters", "doctoral", "faculty"]);
		if (!scope || !validScopes.has(scope)) {
			return reply.code(400).send({ error: "scope must be undergraduate, masters, doctoral, or faculty." });
		}

		try {
			const userId = await resolveUserId(request.headers.authorization);
			if (userId) {
				await assertStudentHasTokenBalance(userId);
			}
			const sourceContext = await buildResearchSourceContext(userId, body.sources);

			const result = await generateResearchIdeas({
				disciplineLabel: body.disciplineLabel.trim(),
				topic: body.topic.trim(),
				scope: scope as "undergraduate" | "masters" | "doctoral" | "faculty",
				sourceContext,
			});

			let tokenQuota;
			if (userId && result.usage?.totalTokens) {
				tokenQuota = await deductStudentTokens(userId, result.usage.totalTokens);
			}

			return {
				ideasMarkdown: result.ideasMarkdown,
				analysis: result.analysis,
				...(tokenQuota ? { tokenQuota } : {}),
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(502).send({ error: message });
		}
	});

	app.post("/api/lesson-planner/generate", async (request, reply) => {
		const body = request.body as {
			title?: string;
			department?: string;
			departmentLabel?: string;
			level?: string;
			mode?: string;
			standards?: string;
			sourceMaterial?: string;
			sessionCount?: number;
		};

		if (!body.title?.trim()) {
			return reply.code(400).send({ error: "title is required." });
		}
		if (!body.department?.trim() || !body.departmentLabel?.trim()) {
			return reply.code(400).send({ error: "department is required." });
		}

		const validLevels = new Set([
			"foundation",
			"undergraduate-l1",
			"undergraduate-l2",
			"undergraduate-l3",
			"postgraduate",
			"professional",
		]);
		const level = body.level?.trim();
		if (!level || !validLevels.has(level)) {
			return reply.code(400).send({ error: "Invalid teaching level." });
		}

		const validModes = new Set(["outline", "session", "activities", "rubric"]);
		const modeRaw = body.mode?.trim() || "outline";
		if (!validModes.has(modeRaw)) {
			return reply.code(400).send({ error: "Invalid output mode." });
		}
		const mode = modeRaw as "outline" | "session" | "activities" | "rubric";

		const sessionCount =
			typeof body.sessionCount === "number" && Number.isFinite(body.sessionCount)
				? Math.min(24, Math.max(4, Math.round(body.sessionCount)))
				: undefined;

		try {
			const result = await generateCourseOutline({
				title: body.title.trim(),
				departmentLabel: body.departmentLabel.trim(),
				level: level as "foundation" | "undergraduate-l1" | "undergraduate-l2" | "undergraduate-l3" | "postgraduate" | "professional",
				mode,
				standards: body.standards?.trim() || undefined,
				sourceMaterial: body.sourceMaterial?.trim() || undefined,
				sessionCount,
			});
			return { outline: result.outline, plan: result.outline, mode };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(502).send({ error: message });
		}
	});

	app.post("/api/lesson-planner/presentation", async (request, reply) => {
		const body = request.body as {
			title?: string;
			department?: string;
			departmentLabel?: string;
			level?: string;
			outline?: string;
		};

		if (!body.title?.trim()) {
			return reply.code(400).send({ error: "title is required." });
		}
		if (!body.department?.trim() || !body.departmentLabel?.trim()) {
			return reply.code(400).send({ error: "department is required." });
		}
		if (!body.outline?.trim()) {
			return reply.code(400).send({ error: "outline is required." });
		}

		const validLevels = new Set([
			"foundation",
			"undergraduate-l1",
			"undergraduate-l2",
			"undergraduate-l3",
			"postgraduate",
			"professional",
		]);
		const level = body.level?.trim();
		if (!level || !validLevels.has(level)) {
			return reply.code(400).send({ error: "Invalid teaching level." });
		}

		try {
			const presentation = await generateCoursePresentation({
				title: body.title.trim(),
				departmentLabel: body.departmentLabel.trim(),
				level: level as "foundation" | "undergraduate-l1" | "undergraduate-l2" | "undergraduate-l3" | "postgraduate" | "professional",
				outline: body.outline.trim(),
			});
			return { presentation };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(502).send({ error: message });
		}
	});

	app.get("/api/lesson-planner/saved", async (request) => {
		const userId = await resolveUserId(request.headers.authorization);
		const plans = await listSavedCoursePlans(userId);
		return { plans };
	});

	app.get<{ Params: { id: string } }>("/api/lesson-planner/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		const plan = await getSavedCoursePlan(request.params.id, userId);
		if (!plan) {
			return reply.code(404).send({ error: "Saved course plan not found." });
		}
		return { plan };
	});

	app.post("/api/lesson-planner/saved", async (request, reply) => {
		const body = request.body as {
			id?: string;
			title?: string;
			department?: string;
			level?: string;
			outline?: string;
			presentation?: unknown;
		};

		if (!body.title?.trim() || !body.department?.trim() || !body.level?.trim() || !body.outline?.trim()) {
			return reply.code(400).send({ error: "Title, department, level, and outline are required." });
		}

		try {
			const userId = await resolveUserId(request.headers.authorization);
			const plan = await saveCoursePlan({
				userId,
				id: body.id?.trim() || null,
				title: body.title.trim(),
				department: body.department.trim(),
				level: body.level.trim(),
				outline: body.outline.trim(),
				presentation: body.presentation ?? null,
			});
			return { plan };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("permission") || message.includes("Sign in") ? 403 : 502;
			return reply.code(status).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/lesson-planner/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		const deleted = await deleteSavedCoursePlan(request.params.id, userId);
		if (!deleted) {
			const status = userId ? 404 : 403;
			return reply.code(status).send({
				error:
					status === 403
						? "Sign in to remove course plans saved to your account."
						: "Saved course plan not found.",
			});
		}
		return { ok: true };
	});

	app.get("/api/status", async () => chat.getStatus());

	app.get("/api/outputs", async () => {
		await syncOutputArtifacts(ctx.workingDir);
		const outputs = await listOutputArtifacts();
		return {
			outputs: outputs.length > 0 ? outputs : listOutputs(ctx.workingDir),
			source: outputs.length > 0 ? "database" : "disk",
		};
	});

	app.get<{ Params: { "*": string } }>("/api/outputs/*", async (request, reply) => {
		const rel = request.params["*"];
		try {
			const decoded = decodeURIComponent(rel);
			const result = await getOutputArtifactContentOrRead(ctx.workingDir, decoded);
			return { content: result.content, path: result.path, source: result.source };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.get("/api/research/saved", async (request) => {
		const userId = await resolveUserId(request.headers.authorization);
		const papers = await listSavedResearch(userId);
		return { papers };
	});

	app.get<{ Params: { id: string } }>("/api/research/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		const paper = await getSavedResearchById(request.params.id, userId);
		if (!paper) {
			return reply.code(404).send({ error: "Saved research not found." });
		}
		return { paper };
	});

	app.patch<{ Params: { id: string } }>("/api/research/saved/:id", async (request, reply) => {
		const body = request.body as { topic?: string; content?: string };
		if (!body.topic?.trim() && !body.content?.trim()) {
			return reply.code(400).send({ error: "Topic or content is required." });
		}
		try {
			const userId = await resolveUserId(request.headers.authorization);
			const paper = await updateSavedResearchById(request.params.id, body, userId);
			if (!paper) {
				return reply.code(404).send({ error: "Saved research not found." });
			}
			return { paper };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/research/saved", async (request, reply) => {
		const body = request.body as {
			topic?: string;
			content?: string;
			sessionId?: string;
			workflow?: string;
			tokenUsage?: {
				promptTokens?: number;
				completionTokens?: number;
				totalTokens?: number;
			};
		};
		if (!body.topic?.trim() || !body.content?.trim()) {
			return reply.code(400).send({ error: "Topic and content are required." });
		}
		try {
			const userId = await resolveUserId(request.headers.authorization);
			const tokenUsage =
				body.tokenUsage &&
				typeof body.tokenUsage.promptTokens === "number" &&
				typeof body.tokenUsage.completionTokens === "number" &&
				typeof body.tokenUsage.totalTokens === "number"
					? {
							promptTokens: body.tokenUsage.promptTokens,
							completionTokens: body.tokenUsage.completionTokens,
							totalTokens: body.tokenUsage.totalTokens,
						}
					: undefined;

			const paper = await saveResearchPaper({
				userId,
				sessionId: body.sessionId,
				topic: body.topic,
				content: body.content,
				workflow: body.workflow,
				tokenUsage,
			});
			return { paper };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete("/api/research/saved", async (request) => {
		const userId = await resolveUserId(request.headers.authorization);
		const deleted = await deleteAllSavedResearch(userId);
		return { ok: true, deleted };
	});

	app.delete<{ Params: { id: string } }>("/api/research/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		const deleted = await deleteSavedResearch(request.params.id, userId);
		if (!deleted) {
			const status = userId ? 404 : 403;
			return reply
				.code(status)
				.send({
					error:
						status === 403
							? "Sign in to remove research saved to your account."
							: "Saved research not found.",
				});
		}
		return { ok: true };
	});

	app.get("/api/research/ideas/saved", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const ideas = await listSavedResearchIdeas(userId);
		return { ideas };
	});

	app.post("/api/research/ideas/saved", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });

		const body = request.body as {
			ideaId?: string;
			title?: string;
			rationale?: string;
			approach?: string;
			outline?: string;
			researchQuestions?: string[];
			type?: string;
			feasibility?: string;
			discipline?: string;
			topic?: string;
			status?: "saved" | "in_progress" | "completed";
		};

		if (
			!body.ideaId?.trim() ||
			!body.title?.trim() ||
			!body.rationale?.trim() ||
			!body.approach?.trim() ||
			!body.type?.trim() ||
			!body.feasibility?.trim() ||
			!body.discipline?.trim() ||
			!body.topic?.trim()
		) {
			return reply.code(400).send({ error: "All idea fields are required." });
		}

		try {
			const idea = await saveResearchIdea(userId, {
				ideaId: body.ideaId,
				title: body.title,
				rationale: body.rationale,
				approach: body.approach,
				type: body.type,
				feasibility: body.feasibility,
				discipline: body.discipline,
				topic: body.topic,
				status: body.status,
				outline: body.outline,
				researchQuestions: Array.isArray(body.researchQuestions)
					? body.researchQuestions.map((q) => String(q).trim()).filter(Boolean)
					: undefined,
			});
			return { idea };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/research/ideas/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });

		const body = request.body as { status?: "saved" | "in_progress" | "completed" };
		if (!body.status || !["saved", "in_progress", "completed"].includes(body.status)) {
			return reply.code(400).send({ error: "Valid status is required." });
		}

		const idea = await updateResearchIdeaStatus(request.params.id, userId, body.status);
		if (!idea) return reply.code(404).send({ error: "Saved idea not found." });
		return { idea };
	});

	app.delete("/api/research/ideas/saved", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteAllSavedResearchIdeas(userId);
		return { ok: true, deleted };
	});

	app.delete<{ Params: { id: string } }>("/api/research/ideas/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteSavedResearchIdea(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Saved idea not found." });
		return { ok: true };
	});

	app.get("/api/research/sessions", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const sessions = await listResearchIdeaSessions(userId);
		return { sessions };
	});

	app.post("/api/research/sessions", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });

		const body = request.body as {
			discipline?: string;
			topic?: string;
			scope?: string;
			ideas?: Array<{
				id?: string;
				title?: string;
				rationale?: string;
				approach?: string;
				type?: string;
				feasibility?: string;
				outline?: string;
				researchQuestions?: string[];
			}>;
		};

		if (!body.discipline?.trim() || !body.topic?.trim() || !body.ideas?.length) {
			return reply.code(400).send({ error: "discipline, topic, and ideas are required." });
		}

		const validScopes = new Set(["undergraduate", "masters", "doctoral", "faculty"]);
		const scope = body.scope?.trim();
		if (!scope || !validScopes.has(scope)) {
			return reply.code(400).send({ error: "Valid scope is required." });
		}

		const ideas = body.ideas
			.filter((idea) => idea.id?.trim() && idea.title?.trim())
			.map((idea) => ({
				id: idea.id!.trim(),
				title: idea.title!.trim(),
				rationale: idea.rationale?.trim() ?? "",
				approach: idea.approach?.trim() ?? "",
				type: idea.type?.trim() ?? "empirical",
				feasibility: idea.feasibility?.trim() ?? "medium",
				...(idea.outline?.trim() ? { outline: idea.outline.trim() } : {}),
				...(Array.isArray(idea.researchQuestions) && idea.researchQuestions.length
					? {
							researchQuestions: idea.researchQuestions
								.map((q) => String(q).trim())
								.filter(Boolean),
						}
					: {}),
			}));

		if (!ideas.length) {
			return reply.code(400).send({ error: "At least one valid idea is required." });
		}

		try {
			const session = await saveResearchIdeaSession(userId, {
				discipline: body.discipline,
				topic: body.topic,
				scope: scope as "undergraduate" | "masters" | "doctoral" | "faculty",
				ideas,
			});
			return { session };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/research/sessions/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteResearchIdeaSession(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Session not found." });
		return { ok: true };
	});

	app.get("/api/research/outlines/saved", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const outlines = await listSavedResearchOutlines(userId);
		return { outlines };
	});

	app.post("/api/research/outlines/saved", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });

		const body = request.body as {
			ideaId?: string;
			ideaTitle?: string;
			discipline?: string;
			topic?: string;
			scope?: string;
			outline?: string;
		};

		const validScopes = new Set(["undergraduate", "masters", "doctoral", "faculty"]);
		const scope = body.scope?.trim();
		if (
			!body.ideaId?.trim() ||
			!body.ideaTitle?.trim() ||
			!body.discipline?.trim() ||
			!body.topic?.trim() ||
			!body.outline?.trim() ||
			!scope ||
			!validScopes.has(scope)
		) {
			return reply.code(400).send({
				error: "ideaId, ideaTitle, discipline, topic, scope, and outline are required.",
			});
		}

		try {
			const outline = await saveResearchOutlineRecord(userId, {
				ideaId: body.ideaId.trim(),
				ideaTitle: body.ideaTitle.trim(),
				discipline: body.discipline.trim(),
				topic: body.topic.trim(),
				scope: scope as "undergraduate" | "masters" | "doctoral" | "faculty",
				outline: body.outline.trim(),
			});
			return { outline };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/research/outlines/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteSavedResearchOutline(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Outline not found." });
		return { ok: true };
	});

	app.get("/api/research/projects", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		try {
			const projects = await listProjects(userId);
			return { projects };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/research/projects", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as {
			title?: string;
			description?: string;
			projectType?: string;
		};
		try {
			const project = await createProject(userId, body);
			return { project };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.get<{ Params: { projectId: string } }>("/api/research/projects/:projectId", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		try {
			const project = await getProject(userId, request.params.projectId);
			return { project };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("not found") ? 404 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.patch<{ Params: { projectId: string } }>("/api/research/projects/:projectId", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as {
			title?: string;
			description?: string;
			status?: "draft" | "in_progress" | "completed";
			favorite?: boolean;
			projectType?: string;
			sections?: Array<{ id: string; title?: string; content?: string }>;
		};
		try {
			const project = await updateProject(userId, request.params.projectId, body);
			return { project };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("not found") ? 404 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.delete<{ Params: { projectId: string } }>("/api/research/projects/:projectId", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		try {
			const deleted = await deleteProject(userId, request.params.projectId);
			if (!deleted) return reply.code(404).send({ error: "Project not found." });
			return { ok: true };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("not found") ? 404 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.get<{ Params: { projectId: string } }>(
		"/api/research/projects/:projectId/notebook",
		async (request, reply) => {
			const userId = await resolveUserId(request.headers.authorization);
			if (!userId) return reply.code(401).send({ error: "Authentication required." });
			try {
				return await getNotebookData(userId, request.params.projectId);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const status = message.includes("not found") ? 404 : 400;
				return reply.code(status).send({ error: message });
			}
		},
	);

	app.put<{ Params: { projectId: string } }>(
		"/api/research/projects/:projectId/notebook",
		async (request, reply) => {
			const userId = await resolveUserId(request.headers.authorization);
			if (!userId) return reply.code(401).send({ error: "Authentication required." });
			const body = request.body as { notebookData?: unknown };
			try {
				return await saveNotebookData(userId, request.params.projectId, body.notebookData ?? null);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const status = message.includes("not found") ? 404 : 400;
				return reply.code(status).send({ error: message });
			}
		},
	);

	app.get<{ Params: { projectId: string } }>(
		"/api/research/projects/:projectId/workspace",
		async (request, reply) => {
			const userId = await resolveUserId(request.headers.authorization);
			if (!userId) return reply.code(401).send({ error: "Authentication required." });
			try {
				const workspace = await getWorkspaceBundle(userId, request.params.projectId);
				return workspace;
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const status = message.includes("not found") ? 404 : 400;
				return reply.code(status).send({ error: message });
			}
		},
	);

	app.get("/api/research/project", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectId = (request.query as { projectId?: string }).projectId;
		try {
			const project = projectId
				? await getProject(userId, projectId)
				: await getOrCreateProject(userId);
			return { project };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("not found") ? 404 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.get("/api/research/workspace", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectIdQuery = (request.query as { projectId?: string }).projectId;
		try {
			const projectId =
				projectIdQuery?.trim() || (await getOrCreateProject(userId)).id;
			const workspace = await getWorkspaceBundle(userId, projectId);
			return workspace;
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("not found") ? 404 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.patch("/api/research/project", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as {
			projectId?: string;
			title?: string;
			description?: string;
			status?: "draft" | "in_progress" | "completed";
			favorite?: boolean;
			projectType?: string;
			sections?: Array<{ id: string; title?: string; content?: string }>;
		};
		try {
			const projectId =
				body.projectId?.trim() || (await getOrCreateProject(userId)).id;
			const project = await updateProject(userId, projectId, body);
			return { project };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("not found") ? 404 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.get("/api/research/activity", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectId = (request.query as { projectId?: string }).projectId;
		const activity = await listActivity(userId, projectId);
		return { activity };
	});

	app.get("/api/research/documents", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectId = (request.query as { projectId?: string }).projectId;
		const documents = await listDocuments(userId, projectId);
		return { documents };
	});

	app.post("/api/research/documents", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as {
			projectId?: string;
			title?: string;
			fileName?: string;
			fileMime?: string;
			fileData?: string;
			sizeLabel?: string;
		};
		try {
			const document = await createDocument(userId, body);
			return { document };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.get<{ Params: { id: string } }>(
		"/api/research/documents/:id/file",
		async (request, reply) => {
			const userId = await resolveUserId(request.headers.authorization);
			if (!userId) return reply.code(401).send({ error: "Authentication required." });
			const file = await getDocumentFile(request.params.id, userId);
			if (!file) return reply.code(404).send({ error: "File not found." });
			return { file };
		},
	);

	app.delete<{ Params: { id: string } }>("/api/research/documents/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteDocument(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Document not found." });
		return { ok: true };
	});

	app.get("/api/research/notes", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectId = (request.query as { projectId?: string }).projectId;
		const notes = await listNotes(userId, projectId);
		return { notes };
	});

	app.post("/api/research/notes", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as { projectId?: string; title?: string; content?: string };
		try {
			const note = await createNote(userId, body);
			return { note };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/research/notes/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as { title?: string; content?: string };
		try {
			const note = await updateNote(request.params.id, userId, body);
			if (!note) return reply.code(404).send({ error: "Note not found." });
			return { note };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/research/notes/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteNote(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Note not found." });
		return { ok: true };
	});

	/** Research Note AI — project OpenRouter via llm.service (no BYO keys). */
	app.post("/api/research-note/ai/generate", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });

		const webRequest = new Request("http://localhost/api/research-note/ai/generate", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(request.body ?? {}),
		});
		const response = await handleResearchNoteGenerate(webRequest);
		const payload = await response.json();
		return reply.code(response.status).send(payload);
	});

	app.get("/api/research/references", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectId = (request.query as { projectId?: string }).projectId;
		const references = await listReferences(userId, projectId);
		return { references };
	});

	app.post("/api/research/references", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as {
			projectId?: string;
			title?: string;
			citation?: string;
			sourceUrl?: string;
		};
		try {
			const reference = await createReference(userId, body);
			return { reference };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/research/references/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteReference(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Reference not found." });
		return { ok: true };
	});

	app.get("/api/research/datasets", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectId = (request.query as { projectId?: string }).projectId;
		const datasets = await listDatasets(userId, projectId);
		return { datasets };
	});

	app.post("/api/research/datasets", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as {
			projectId?: string;
			title?: string;
			description?: string;
			discipline?: string;
			format?: string;
			year?: string;
			license?: string;
			accessUrl?: string;
			sizeLabel?: string;
			tags?: string[];
			visibility?: "private" | "shared";
			fileName?: string;
			fileMime?: string;
			fileData?: string;
		};
		try {
			const dataset = await createDataset(userId, body);
			return { dataset };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("Sign in") ? 401 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.get<{ Params: { id: string } }>("/api/research/datasets/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const dataset = await getDataset(request.params.id, userId);
		if (!dataset) return reply.code(404).send({ error: "Dataset not found." });
		return { dataset };
	});

	app.get<{ Params: { id: string } }>("/api/research/datasets/:id/file", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const file = await getDatasetFile(request.params.id, userId);
		if (!file) return reply.code(404).send({ error: "File not found." });
		return { file };
	});

	app.post<{ Params: { id: string } }>("/api/research/datasets/:id/plot", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = (request.body ?? {}) as { chartType?: string; prompt?: string };
		try {
			const plot = await plotDatasetGraph(request.params.id, userId, body);
			return { plot };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("Sign in") ? 401 : message.includes("not found") ? 404 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.post("/api/research/source-context", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = (request.body ?? {}) as { sources?: ResearchSourceSelection };
		try {
			const sourceContext = await buildResearchSourceContext(userId, body.sources);
			return { sourceContext: sourceContext || "" };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/research/visualizations", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = (request.body ?? {}) as {
			datasetIds?: string[];
			projectIds?: string[];
			topic?: string;
		};
		try {
			const artifacts = await buildPaperVisualizationArtifacts(userId, body);
			return {
				artifacts: artifacts.artifacts,
				figureAppendix: artifacts.figureAppendix,
				hasSavedFigures: artifacts.hasSavedFigures,
			};
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("Sign in") ? 401 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/research/datasets/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteDataset(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Dataset not found." });
		return { ok: true };
	});

	app.post("/api/research/outputs/sync", async () => {
		const synced = await syncOutputArtifacts(ctx.workingDir);
		const outputs = await listOutputArtifacts();
		return { synced, outputs };
	});

	app.post("/api/session/reset", async (request) => {
		const body = request.body as { workflow?: string; topic?: string; prompt?: string };
		await chat.resetSession(body);
		return { ok: true, status: chat.getStatus() };
	});

	app.post("/api/chat/abort", async () => {
		await chat.abort();
		return { ok: true };
	});

	app.get("/api/sessions/:id/messages", async (request, reply) => {
		const { id } = request.params as { id: string };
		try {
			const messages = await chat.getSessionMessages(id);
			return { messages };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.get("/api/dashboard/stats", async () => getDashboardStats());

	app.get("/api/dashboard/sessions", async () => ({
		sessions: await listRecentSessions(),
	}));

	app.get("/api/users", async () => ({ users: await listUsers() }));

	app.post("/api/users", async (request, reply) => {
		const body = request.body as { name?: string; email?: string; role?: string; status?: string };
		if (!body.name?.trim() || !body.email?.trim()) {
			return reply.code(400).send({ error: "Name and email are required." });
		}
		try {
			const user = await createUser({
				name: body.name,
				email: body.email,
				role: body.role,
				status: body.status,
			});
			return { user };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/users/:id", async (request, reply) => {
		const body = request.body as Partial<{ name: string; email: string; role: string; status: string }>;
		try {
			const user = await updateUser(request.params.id, body);
			if (!user) return reply.code(404).send({ error: "User not found." });
			return { user };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/users/:id", async (request, reply) => {
		const deleted = await deleteUser(request.params.id);
		if (!deleted) return reply.code(404).send({ error: "User not found." });
		return { ok: true };
	});

	app.get("/api/admin/stats", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			return { stats: await adminGetDashboardStats(scope) };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Querystring: { limit?: string } }>("/api/admin/sessions/recent-topics", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const limit = Number.parseInt(request.query.limit ?? "8", 10);
			const sessions = await adminListRecentSessionTopics(Number.isFinite(limit) ? limit : 8, scope);
			return { sessions };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Querystring: { limit?: string } }>("/api/admin/sessions", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const limit = Number.parseInt(request.query.limit ?? "50", 10);
			const sessions = await adminListRecentSessions(Number.isFinite(limit) ? limit : 50, scope);
			return { sessions };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Params: { id: string } }>("/api/admin/sessions/:id", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			const session = await getAdminSession(request.params.id);
			if (!session) return reply.code(404).send({ error: "Session not found." });
			return { session };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post<{ Params: { id: string } }>("/api/admin/sessions/:id/stop", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			const session = await stopAdminSession(request.params.id);
			if (!session) return reply.code(404).send({ error: "Session not found." });
			return { session };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/sessions/:id", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			const deleted = await deleteAdminSession(request.params.id);
			if (!deleted) return reply.code(404).send({ error: "Session not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/users", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			return { users: await adminListUsers(scope) };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/admins", async (request, reply) => {
		try {
			await requireSuperAdmin(request.headers.authorization);
			return { users: await adminListConsoleAdmins() };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/universities", async (request, reply) => {
		try {
			await requireSuperAdmin(request.headers.authorization);
			return { universities: await adminListUniversities() };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/universities", async (request, reply) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const body = request.body as {
				catalogueId?: string;
				name?: string;
				status?: "active" | "inactive";
			};
			if (!body.catalogueId?.trim() || !body.name?.trim()) {
				return reply.code(400).send({ error: "catalogueId and name are required." });
			}
			const university = await onboardUniversity({
				catalogueId: body.catalogueId,
				name: body.name,
				status: body.status ?? "active",
				onboardedBy: adminId,
			});
			await recordAuditEvent({
				action: "admin.university_onboarded",
				category: "admin",
				actorId: adminId,
				summary: `Onboarded university ${university.name}`,
				targetType: "university",
				targetId: university.id,
				severity: "medium",
			});
			return { university };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/universities/:id", async (request, reply) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const body = request.body as Partial<{ name: string; status: "active" | "inactive" }>;
			const university = await updateUniversity(request.params.id, body, adminId);
			if (!university) return reply.code(404).send({ error: "University not found." });
			await recordAuditEvent({
				action: "admin.university_updated",
				category: "admin",
				actorId: adminId,
				summary: `Updated university ${university.name} (${university.status})`,
				targetType: "university",
				targetId: university.id,
				severity: "low",
			});
			return { university };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/admin/users", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				name?: string;
				email?: string;
				role?: string;
				status?: string;
				department?: string;
				institution?: string;
				universityId?: string;
				faculty?: string;
				programme?: string;
				cohort?: string;
				password?: string;
			};
			if (!body.name?.trim() || !body.email?.trim()) {
				return reply.code(400).send({ error: "Name and email are required." });
			}
			const user = await adminCreateUser(
				{
					name: body.name,
					email: body.email,
					role: body.role,
					status: body.status,
					department: body.department,
					institution: body.institution,
					universityId: body.universityId,
					faculty: body.faculty,
					programme: body.programme,
					cohort: body.cohort,
					password: body.password,
				},
				scope,
			);
			return { user };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/users/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Partial<{
				name: string;
				email: string;
				role: string;
				status: string;
				department: string;
				institution: string;
				universityId: string | null;
				faculty: string;
				programme: string;
				cohort: string;
			}>;
			const user = await adminUpdateUser(request.params.id, body, scope);
			if (!user) return reply.code(404).send({ error: "User not found." });
			return { user };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/users/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const deleted = await adminDeleteUser(request.params.id, scope);
			if (!deleted) return reply.code(404).send({ error: "User not found." });
			await recordAuditEvent({
				action: "admin.user_deleted",
				category: "admin",
				actorId: scope.actorId,
				summary: `Deleted user ${request.params.id}`,
				targetType: "user",
				targetId: request.params.id,
				severity: "medium",
			});
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post<{ Params: { id: string } }>("/api/admin/users/:id/reset-password", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as { password?: string };
			if (!body.password?.trim()) {
				return reply.code(400).send({ error: "Password is required." });
			}
			const user = await resetUserPassword(request.params.id, body.password, scope);
			if (!user) return reply.code(404).send({ error: "User not found." });
			return { user };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/admin/users/bulk-status", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as { ids?: string[]; status?: "active" | "inactive" | "suspended" };
			if (!body.ids?.length || !body.status) {
				return reply.code(400).send({ error: "ids and status are required." });
			}
			return await bulkUpdateUserStatus(body.ids, body.status, scope);
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/users/bulk-delete", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as { ids?: string[] };
			if (!body.ids?.length) {
				return reply.code(400).send({ error: "ids are required." });
			}
			return await bulkDeleteUsers(body.ids, scope);
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/lectures", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			const [lectures, stats] = await Promise.all([listAllLectures(), getLectureAdminStats()]);
			return { lectures, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/lectures/:id", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			const deleted = await adminDeleteLecture(request.params.id);
			if (!deleted) return reply.code(404).send({ error: "Lecture not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/tokens", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const [users, stats] = await Promise.all([
				listUsersTokenQuotas(scope),
				getTokenAdminStats(scope),
			]);
			return { users, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/tokens/bulk-reset", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as { ids?: string[] };
			if (!body.ids?.length) {
				return reply.code(400).send({ error: "ids are required." });
			}
			return await bulkResetUserTokens(body.ids, scope);
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/tokens/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as { reset?: boolean; tokensUsed?: number };
			let record;
			if (body.reset) {
				record = await resetUserTokens(request.params.id, scope);
			} else if (body.tokensUsed !== undefined) {
				record = await setUserTokensUsed(request.params.id, body.tokensUsed, scope);
			} else {
				return reply.code(400).send({ error: "Provide reset: true or tokensUsed." });
			}
			if (!record) return reply.code(404).send({ error: "User not found." });
			return { user: record };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/backup/tables", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			const tables = await listBackupTables();
			return { tables };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/backup/files", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			return { files: listBackupFiles() };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/backup", async (request, reply) => {
		try {
			const adminId = await requireAdmin(request.headers.authorization);
			const file = await createDatabaseBackup();
			await recordAuditEvent({
				action: "admin.backup_created",
				category: "system",
				actorId: adminId,
				summary: `Created database backup ${file.filename}`,
				targetType: "backup",
				targetId: file.filename,
				details: { size: file.size, tableCount: file.tableCount },
			});
			return { file };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Params: { filename: string } }>("/api/admin/backup/files/:filename", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			const { content, size } = readBackupFile(request.params.filename);
			return reply
				.header("Content-Type", "application/json; charset=utf-8")
				.header("Content-Disposition", `attachment; filename="${request.params.filename}"`)
				.header("Content-Length", String(size))
				.send(content);
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("not found") || message.includes("Invalid") ? 404 : 500;
			return reply.code(status).send({ error: message });
		}
	});

	/* ── Institutional AI governance ─────────────────────────────────── */

	app.get("/api/admin/governance", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			return { dashboard: await getGovernanceDashboard(scope) };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/analytics", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			return { analytics: await getUsageAnalytics(scope) };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/overview", async (request, reply) => {
		try {
			await requireAdmin(request.headers.authorization);
			return { overview: await getPlatformOverview() };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/policies", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const [policies, stats] = await Promise.all([listPolicies(scope), getPolicyStats(scope)]);
			return { policies, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/policies", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				name?: string;
				description?: string;
				scope?: string;
				target?: string;
				effect?: string;
				roles?: string[];
				faculties?: string[];
				enabled?: boolean;
				priority?: number;
			};
			if (!body.name?.trim() || !body.scope || !body.target?.trim() || !body.effect) {
				return reply.code(400).send({ error: "name, scope, target, and effect are required." });
			}
			const policy = await createPolicy(
				{
					name: body.name,
					description: body.description,
					scope: body.scope as "feature" | "dataset" | "tool" | "use_case" | "content",
					target: body.target,
					effect: body.effect as "permitted" | "restricted" | "blocked",
					roles: body.roles,
					faculties: body.faculties,
					enabled: body.enabled,
					priority: body.priority,
				},
				scope.actorId,
				scope,
			);
			return { policy };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/policies/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Partial<{
				name: string;
				description: string;
				scope: "feature" | "dataset" | "tool" | "use_case" | "content";
				target: string;
				effect: "permitted" | "restricted" | "blocked";
				roles: string[];
				faculties: string[];
				enabled: boolean;
				priority: number;
			}>;
			const policy = await updatePolicy(request.params.id, body, scope.actorId, scope);
			if (!policy) return reply.code(404).send({ error: "Policy not found." });
			return { policy };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/policies/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const deleted = await deletePolicy(request.params.id, scope.actorId, scope);
			if (!deleted) return reply.code(404).send({ error: "Policy not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/policies/evaluate", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				scope?: "feature" | "dataset" | "tool" | "use_case" | "content";
				target?: string;
				role?: string;
				faculty?: string;
			};
			if (!body.scope || !body.target?.trim() || !body.role) {
				return reply.code(400).send({ error: "scope, target, and role are required." });
			}
			const result = await evaluatePolicy({
				scope: body.scope,
				target: body.target,
				role: body.role,
				faculty: body.faculty,
			}, scope);
			return { result };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{
		Querystring: { limit?: string; flagged?: string; category?: string; severity?: string; q?: string };
	}>("/api/admin/audit", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const limit = Number.parseInt(request.query.limit ?? "100", 10);
			const [logs, stats] = await Promise.all([
				listAuditLogs({
					limit: Number.isFinite(limit) ? limit : 100,
					flaggedOnly: request.query.flagged === "1" || request.query.flagged === "true",
					category: request.query.category,
					severity: request.query.severity,
					search: request.query.q,
				}, scope),
				getAuditAlertStats(scope),
			]);
			return { logs, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/audit", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				action?: string;
				category?: string;
				summary?: string;
				details?: Record<string, unknown>;
				severity?: "info" | "low" | "medium" | "high" | "critical";
				flagged?: boolean;
				flagReason?: string;
			};
			if (!body.action?.trim() || !body.category || !body.summary?.trim()) {
				return reply.code(400).send({ error: "action, category, and summary are required." });
			}
			const log = await recordAuditEvent({
				action: body.action,
				category: body.category as
					| "auth"
					| "admin"
					| "ai_use"
					| "policy"
					| "approval"
					| "data"
					| "security"
					| "system"
					| "report",
				actorId: scope.actorId,
				summary: body.summary,
				details: body.details,
				severity: body.severity,
				flagged: body.flagged,
				flagReason: body.flagReason,
				ip: request.ip,
				userAgent: request.headers["user-agent"],
			});
			return { log };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post<{ Params: { id: string } }>("/api/admin/audit/:id/flag", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				reason?: string;
				severity?: "info" | "low" | "medium" | "high" | "critical";
			};
			if (!body.reason?.trim()) {
				return reply.code(400).send({ error: "reason is required." });
			}
			const log = await flagAuditLog(
				request.params.id,
				body.reason,
				body.severity ?? "high",
				scope.actorId,
				scope,
			);
			if (!log) return reply.code(404).send({ error: "Audit log not found." });
			return { log };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Querystring: { status?: string; kind?: string; limit?: string } }>(
		"/api/admin/approvals",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const limit = Number.parseInt(request.query.limit ?? "100", 10);
				const [approvals, stats] = await Promise.all([
					listApprovals({
						status: request.query.status,
						kind: request.query.kind,
						limit: Number.isFinite(limit) ? limit : 100,
					}, scope),
					getApprovalStats(scope),
				]);
				return { approvals, stats };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({ error: message });
			}
		},
	);

	app.post("/api/admin/approvals", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				title?: string;
				description?: string;
				kind?: "tool" | "dataset" | "use_case" | "model" | "integration";
				justification?: string;
				riskNotes?: string;
				requesterId?: string;
			};
			if (!body.title?.trim() || !body.kind) {
				return reply.code(400).send({ error: "title and kind are required." });
			}
			const approval = await createApproval(
				{
					title: body.title,
					description: body.description,
					kind: body.kind,
					justification: body.justification,
					riskNotes: body.riskNotes,
					requesterId: body.requesterId || scope.actorId,
				},
				scope.actorId,
				scope,
			);
			return { approval };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/approvals/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				status?: "under_review" | "approved" | "rejected" | "withdrawn";
				reviewNotes?: string;
			};
			if (!body.status) {
				return reply.code(400).send({ error: "status is required." });
			}
			const approval = await reviewApproval(
				request.params.id,
				{ status: body.status, reviewNotes: body.reviewNotes },
				scope.actorId,
				scope,
			);
			if (!approval) return reply.code(404).send({ error: "Approval not found." });
			return { approval };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.get("/api/admin/reports", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			return { reports: await listGovernanceReports(undefined, scope) };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Params: { id: string } }>("/api/admin/reports/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const report = await getGovernanceReport(request.params.id, scope);
			if (!report) return reply.code(404).send({ error: "Report not found." });
			return { report };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/reports/generate", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = (request.body ?? {}) as {
				audience?: "management" | "senate" | "both";
				periodStart?: string;
				periodEnd?: string;
				reportType?: string;
				format?: string;
				faculty?: string;
				department?: string;
				programme?: string;
				userRole?: string;
			};
			const report = await generateGovernanceReport({
				audience: body.audience ?? "both",
				periodStart: body.periodStart,
				periodEnd: body.periodEnd,
				reportType: body.reportType,
				format: body.format,
				faculty: body.faculty,
				department: body.department,
				programme: body.programme,
				userRole: body.userRole,
				actorId: scope.actorId,
				scope,
			});
			return { report };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	/* ── Risk, compliance, incidents, AI inventory ───────────────────── */

	app.get<{ Querystring: { status?: string; category?: string } }>("/api/admin/risks", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const [risks, stats] = await Promise.all([
				listRisks({ status: request.query.status, category: request.query.category }, scope),
				getRiskStats(scope),
			]);
			return { risks, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/risks", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				title?: string;
				description?: string;
				category?: string;
				status?: string;
				likelihood?: number;
				impact?: number;
				residualLikelihood?: number;
				residualImpact?: number;
				faculty?: string;
				department?: string;
				ownerName?: string;
				controls?: string;
				treatmentPlan?: string;
			};
			if (!body.title?.trim() || !body.category || body.likelihood == null || body.impact == null) {
				return reply.code(400).send({ error: "title, category, likelihood, and impact are required." });
			}
			const risk = await createRisk(
				{
					title: body.title,
					description: body.description,
					category: body.category as
						| "data_protection"
						| "academic_integrity"
						| "model_safety"
						| "access_control"
						| "third_party"
						| "operational"
						| "legal"
						| "reputational",
					status: body.status as "open" | "mitigating" | "accepted" | "closed" | undefined,
					likelihood: body.likelihood,
					impact: body.impact,
					residualLikelihood: body.residualLikelihood,
					residualImpact: body.residualImpact,
					faculty: body.faculty,
					department: body.department,
					ownerName: body.ownerName,
					controls: body.controls,
					treatmentPlan: body.treatmentPlan,
				},
				scope.actorId,
				scope,
			);
			return { risk };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/risks/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			const risk = await updateRisk(request.params.id, body as never, scope.actorId, scope);
			if (!risk) return reply.code(404).send({ error: "Risk not found." });
			return { risk };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/risks/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const deleted = await deleteRisk(request.params.id, scope.actorId, scope);
			if (!deleted) return reply.code(404).send({ error: "Risk not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Querystring: { framework?: string; status?: string } }>(
		"/api/admin/compliance",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const [controls, stats] = await Promise.all([
					listComplianceControls({
						framework: request.query.framework,
						status: request.query.status,
					}, scope),
					getComplianceStats(scope),
				]);
				return { controls, stats };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({ error: message });
			}
		},
	);

	app.post("/api/admin/compliance", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				code?: string;
				title?: string;
				description?: string;
				framework?: string;
				domain?: string;
				priority?: string;
				status?: "not_started" | "in_progress" | "compliant" | "gap" | "not_applicable";
				ownerName?: string;
				evidence?: string;
				notes?: string;
			};
			if (!body.code?.trim() || !body.title?.trim() || !body.framework || !body.domain) {
				return reply.code(400).send({ error: "code, title, framework, and domain are required." });
			}
			const control = await createComplianceControl(
				{
					code: body.code,
					title: body.title,
					description: body.description,
					framework: body.framework as
						| "nigeria_ai_act"
						| "eu_ai_act"
						| "ndpr"
						| "institutional"
						| "iso_42001"
						| "unesco",
					domain: body.domain as
						| "transparency"
						| "human_oversight"
						| "data_governance"
						| "accuracy_robustness"
						| "privacy"
						| "accountability"
						| "fairness"
						| "security",
					priority: body.priority,
					status: body.status,
					ownerName: body.ownerName,
					evidence: body.evidence,
					notes: body.notes,
				},
				scope.actorId,
				scope,
			);
			return { control };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/compliance/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Partial<{
				status: "not_started" | "in_progress" | "compliant" | "gap" | "not_applicable";
				evidence: string;
				ownerName: string;
				priority: string;
				notes: string;
				nextReviewAt: string | null;
			}>;
			const control = await updateComplianceControl(request.params.id, body, scope.actorId, scope);
			if (!control) return reply.code(404).send({ error: "Control not found." });
			return { control };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/compliance/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const deleted = await deleteComplianceControl(request.params.id, scope.actorId, scope);
			if (!deleted) return reply.code(404).send({ error: "Control not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Querystring: { status?: string; severity?: string; kind?: string } }>(
		"/api/admin/incidents",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const [incidents, stats] = await Promise.all([
					listIncidents(
						{
							status: request.query.status,
							severity: request.query.severity,
							kind: request.query.kind,
						},
						scope,
					),
					getIncidentStats(scope),
				]);
				return { incidents, stats };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({ error: message });
			}
		},
	);

	app.post("/api/admin/incidents", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				title?: string;
				description?: string;
				kind?: string;
				severity?: string;
				faculty?: string;
				department?: string;
				reportedByName?: string;
				reportedByEmail?: string;
				userInvolvedName?: string;
				assigneeName?: string;
				impactSummary?: string;
				evidence?: string | string[];
				linkedAuditId?: string;
			};
			if (!body.title?.trim() || !body.kind) {
				return reply.code(400).send({ error: "title and kind are required." });
			}
			const incident = await createIncident(
				{
					title: body.title,
					description: body.description,
					kind: body.kind as
						| "policy_breach"
						| "sensitive_data"
						| "unauthorized_use"
						| "model_failure"
						| "third_party"
						| "academic_misconduct"
						| "other",
					severity: body.severity as "low" | "medium" | "high" | "critical" | undefined,
					faculty: body.faculty,
					department: body.department,
					reportedByName: body.reportedByName,
					reportedByEmail: body.reportedByEmail,
					userInvolvedName: body.userInvolvedName,
					assigneeName: body.assigneeName,
					impactSummary: body.impactSummary,
					evidence: body.evidence,
					linkedAuditId: body.linkedAuditId,
				},
				scope.actorId,
				scope,
			);
			return { incident };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/incidents/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			const incident = await updateIncident(request.params.id, body as never, scope.actorId, scope);
			if (!incident) return reply.code(404).send({ error: "Incident not found." });
			return { incident };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	/* ── Governance alerts ───────────────────────────────────────────── */

	app.get<{ Querystring: { status?: string; severity?: string; kind?: string } }>(
		"/api/admin/alerts",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const [alerts, stats] = await Promise.all([
					listAlerts({
						status: request.query.status,
						severity: request.query.severity,
						kind: request.query.kind,
					}, scope),
					getAlertStats(scope),
				]);
				return { alerts, stats };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({ error: message });
			}
		},
	);

	app.post("/api/admin/alerts", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as {
				title?: string;
				summary?: string;
				kind?: string;
				severity?: string;
				faculty?: string;
				department?: string;
				actorEmail?: string;
				actorName?: string;
				assigneeName?: string;
				linkedAuditId?: string;
			};
			if (!body.title?.trim() || !body.summary?.trim() || !body.kind) {
				return reply.code(400).send({ error: "title, summary, and kind are required." });
			}
			const alert = await createAlert(
				{
					title: body.title,
					summary: body.summary,
					kind: body.kind as never,
					severity: body.severity as "low" | "medium" | "high" | "critical" | undefined,
					faculty: body.faculty,
					department: body.department,
					actorEmail: body.actorEmail,
					actorName: body.actorName,
					assigneeName: body.assigneeName,
					linkedAuditId: body.linkedAuditId,
				},
				scope.actorId,
				scope,
			);
			return { alert };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/alerts/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			const alert = await updateAlert(request.params.id, body as never, scope.actorId, scope);
			if (!alert) return reply.code(404).send({ error: "Alert not found." });
			return { alert };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	/* ── AI contribution statements ──────────────────────────────────── */

	app.get<{
		Querystring: { verified?: string; disclosureComplete?: string; outputType?: string };
	}>("/api/admin/contributions", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const [statements, stats] = await Promise.all([
				listContributionStatements(
					{
						verified:
							request.query.verified === "1"
								? true
								: request.query.verified === "0"
									? false
									: undefined,
						disclosureComplete:
							request.query.disclosureComplete === "1"
								? true
								: request.query.disclosureComplete === "0"
									? false
									: undefined,
						outputType: request.query.outputType,
					},
					scope,
				),
				getContributionStats(scope),
			]);
			return { statements, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/contributions", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			if (!body.outputRef || !body.outputTitle) {
				return reply.code(400).send({ error: "outputRef and outputTitle are required." });
			}
			const statement = await createContributionStatement(body as never, scope.actorId, scope);
			return { statement };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>(
		"/api/admin/contributions/:id",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const admin = await UserModel.findById(scope.actorId).select("name").lean();
				const body = request.body as Record<string, unknown>;
				const statement = await verifyContributionStatement(
					request.params.id,
					body as never,
					scope.actorId,
					admin?.name,
					scope,
				);
				if (!statement) return reply.code(404).send({ error: "Statement not found." });
				return { statement };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(400).send({ error: message });
			}
		},
	);

	/* ── Research provenance ─────────────────────────────────────────── */

	app.get<{ Querystring: { status?: string; outputType?: string } }>(
		"/api/admin/provenance",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const [records, stats] = await Promise.all([
					listProvenanceRecords(
						{
							status: request.query.status,
							outputType: request.query.outputType,
						},
						scope,
					),
					getProvenanceStats(scope),
				]);
				return { records, stats };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({ error: message });
			}
		},
	);

	app.post("/api/admin/provenance", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			if (!body.outputRef || !body.outputTitle) {
				return reply.code(400).send({ error: "outputRef and outputTitle are required." });
			}
			const record = await createProvenanceRecord(body as never, scope.actorId, scope);
			return { record };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/provenance/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const admin = await UserModel.findById(scope.actorId).select("name").lean();
			const body = request.body as Record<string, unknown>;
			const record = await reviewProvenanceRecord(
				request.params.id,
				body as never,
				scope.actorId,
				admin?.name,
				scope,
			);
			if (!record) return reply.code(404).send({ error: "Provenance record not found." });
			return { record };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	/* ── Research privacy controls ───────────────────────────────────── */

	app.get("/api/admin/privacy", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const [settings, stats] = await Promise.all([listPrivacySettings(scope), getPrivacyStats(scope)]);
			return { settings, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/privacy", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			if (!body.name || !body.dataClass) {
				return reply.code(400).send({ error: "name and dataClass are required." });
			}
			const setting = await createPrivacySetting(body as never, scope.actorId, scope);
			return { setting };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/privacy/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			const setting = await updatePrivacySetting(request.params.id, body as never, scope.actorId, scope);
			if (!setting) return reply.code(404).send({ error: "Privacy setting not found." });
			return { setting };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/privacy/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const deleted = await deletePrivacySetting(request.params.id, scope.actorId, scope);
			if (!deleted) return reply.code(404).send({ error: "Privacy setting not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	/* ── Retention & deletion ────────────────────────────────────────── */

	app.get("/api/admin/retention", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const [policies, deletionRequests, stats] = await Promise.all([
				listRetentionPolicies(scope),
				listDeletionRequests(undefined, scope),
				getRetentionStats(scope),
			]);
			return { policies, deletionRequests, stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/retention/policies", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			if (!body.name || !body.dataCategory || body.retainDays == null) {
				return reply
					.code(400)
					.send({ error: "name, dataCategory, and retainDays are required." });
			}
			const policy = await createRetentionPolicy(body as never, scope.actorId, scope);
			return { policy };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>(
		"/api/admin/retention/policies/:id",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const body = request.body as Record<string, unknown>;
				const policy = await updateRetentionPolicy(
					request.params.id,
					body as never,
					scope.actorId,
					scope,
				);
				if (!policy) return reply.code(404).send({ error: "Retention policy not found." });
				return { policy };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(400).send({ error: message });
			}
		},
	);

	app.delete<{ Params: { id: string } }>(
		"/api/admin/retention/policies/:id",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const deleted = await deleteRetentionPolicy(request.params.id, scope.actorId, scope);
				if (!deleted) return reply.code(404).send({ error: "Retention policy not found." });
				return { ok: true };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({ error: message });
			}
		},
	);

	app.post("/api/admin/retention/deletion-requests", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			if (!body.subjectName || !body.subjectEmail) {
				return reply.code(400).send({ error: "subjectName and subjectEmail are required." });
			}
			const deletionRequest = await createDeletionRequest(body as never, scope.actorId, scope);
			return { deletionRequest };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>(
		"/api/admin/retention/deletion-requests/:id",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const body = request.body as Record<string, unknown>;
				const deletionRequest = await updateDeletionRequest(
					request.params.id,
					body as never,
					scope.actorId,
					scope,
				);
				if (!deletionRequest) {
					return reply.code(404).send({ error: "Deletion request not found." });
				}
				return { deletionRequest };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(400).send({ error: message });
			}
		},
	);

	app.get<{ Querystring: { status?: string; riskTier?: string } }>(
		"/api/admin/inventory",
		async (request, reply) => {
			try {
				const scope = await requireAdminScope(request.headers.authorization);
				const [systems, stats] = await Promise.all([
					listAiSystems({
						status: request.query.status,
						riskTier: request.query.riskTier,
					}, scope),
					getAiSystemStats(scope),
				]);
				return { systems, stats };
			} catch (error) {
				if (error instanceof AdminRequiredError) {
					return reply.code(error.statusCode).send({ error: error.message });
				}
				const message = error instanceof Error ? error.message : String(error);
				return reply.code(500).send({ error: message });
			}
		},
	);

	app.post("/api/admin/inventory", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			if (!body.name || typeof body.name !== "string" || !body.name.trim()) {
				return reply.code(400).send({ error: "name is required." });
			}
			const system = await createAiSystem(body as never, scope.actorId, scope);
			return { system };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/admin/inventory/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const body = request.body as Record<string, unknown>;
			const system = await updateAiSystem(request.params.id, body as never, scope.actorId, scope);
			if (!system) return reply.code(404).send({ error: "System not found." });
			return { system };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/inventory/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const deleted = await deleteAiSystem(request.params.id, scope.actorId, scope);
			if (!deleted) return reply.code(404).send({ error: "System not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.register(async (scoped) => {
		scoped.get("/ws", { websocket: true }, (socket, request) => {
			const socketUserId = resolveUserIdFromWsUrl(request.url);

			const send = (payload: Record<string, unknown>) => {
				if (socket.readyState === socket.OPEN) {
					socket.send(JSON.stringify(payload));
				}
			};

			const unsubscribe = chat.subscribe(send);

			send({
				type: "connected",
				status: chat.getStatus(),
				workflows: workflows.map((w) => ({
					name: w.name,
					description: w.description,
					command: w.command,
				})),
			});

			socket.on("message", async (raw: Buffer | ArrayBuffer | Buffer[]) => {
				try {
					const data = JSON.parse(String(raw)) as {
						type?: string;
						message?: string;
						workflow?: string;
						topic?: string;
					};

					if (data.type === "reset") {
						await chat.resetSession({
							workflow: data.workflow,
							topic: data.topic,
							prompt: data.message,
							userId: socketUserId ?? undefined,
						});
						send({ type: "reset_complete", status: chat.getStatus() });
						return;
					}

					if (data.type === "abort") {
						await chat.abort();
						send({ type: "aborted" });
						return;
					}

					if (data.type === "prompt" && data.message) {
						await chat.sendMessage(data.message, socketUserId ?? undefined);
						send({ type: "prompt_complete" });
						return;
					}

					send({ type: "error", error: "Unknown message type." });
				} catch (error) {
					const message = error instanceof Error ? error.message : String(error);
					send({ type: "error", error: message });
				}
			});

			socket.on("close", () => unsubscribe());
		});
	});

	if (staticRoot) {
		app.setNotFoundHandler(async (request, reply) => {
			if (request.url.startsWith("/api/") || request.url.startsWith("/ws")) {
				return reply.code(404).send({ error: "Not found" });
			}

			const htmlPath = resolveStaticHtml(staticRoot, request.url);
			if (htmlPath) {
				return reply.type("text/html; charset=utf-8").send(readFileSync(htmlPath));
			}

			return reply.code(404).send({ error: "Not found" });
		});
	}

	await app.listen({ port, host: "0.0.0.0" });
	console.log(`GARIL AI web UI: http://localhost:${port}`);
	if (!staticRoot) {
		console.log("Frontend not built. Run: npm run build (or npm run deploy:build)");
	}

	const shutdown = async () => {
		await chat.abort();
		await app.close();
		await disconnectMongo();
	};

	process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}
