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
import { assertS3Ready, s3Enabled } from "./services/s3.service.js";
import { getS3Bucket, getS3Endpoint } from "./config/env.js";
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
import {
	cancelResearchJob,
	failOrphanedResearchJobs,
	getActiveResearchJob,
	getResearchJobById,
	startResearchPaperJob,
} from "./services/research-jobs.service.js";
import { listWorkflows } from "./services/workflows.js";
import { fetchPapersForQuery } from "./services/alphaxiv.service.js";
import { abortSignalFromRequest } from "./lib/request-abort.js";
import { generateResearchOutline, normalizeResearchScope } from "./services/outline.service.js";
import { generateResearchIdeas } from "./services/research-ideas.service.js";
import {
	assertStudentHasTokenBalance,
	deductStudentTokens,
} from "./services/student-token.service.js";
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
	beginDatasetDirectUpload,
	completeDatasetDirectUpload,
	createDataset,
	createDocument,
	createProject,
	createQuestionnaire,
	createReference,
	deleteDataset,
	deleteDocument,
	deleteProject,
	deleteQuestionnaire,
	deleteReference,
	getDataset,
	getDatasetFile,
	getDocumentFile,
	getOrCreateProject,
	getProject,
	getWorkspaceBundle,
	importQuestionnaireResponses,
	listActivity,
	listDatasets,
	listDocuments,
	listProjects,
	listQuestionnaires,
	listReferences,
	updateProject,
	updateQuestionnaire,
} from "./services/research-assets.service.js";
import { buildPaperVisualizationArtifacts, plotDatasetGraph } from "./services/research-graph.service.js";
import {
	buildResearchSourceContext,
	type ResearchSourceSelection,
} from "./services/research-source-context.service.js";
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
	setUserTokenAllowance,
	setUserTokensUsed,
} from "./services/admin-tokens.service.js";
import {
	bulkDeleteAdminResearchPapers,
	bulkDeleteAdminResearchUploads,
	deleteAdminResearchPaper,
	deleteAdminResearchUpload,
	getAdminResearchPaper,
	getAdminResearchStats,
	listAdminResearchPapers,
	listAdminResearchUploads,
	type AdminResearchUploadKind,
} from "./services/admin-research.service.js";
import {
	bulkDeleteUsers,
	bulkUpdateUserStatus,
	createUser as adminCreateUser,
	deleteUser as adminDeleteUser,
	getAdminUserById,
	getDashboardStats as adminGetDashboardStats,
	getUserGovernanceHistory,
	listConsoleAdmins as adminListConsoleAdmins,
	listRecentSessions as adminListRecentSessions,
	listRecentSessionTopics as adminListRecentSessionTopics,
	listUsers as adminListUsers,
	resetUserPassword,
	updateUser as adminUpdateUser,
} from "./services/admin-users.service.js";
import {
	getUniversityRecord,
	listActiveUniversitiesForRegistration,
	listUniversities as adminListUniversities,
	offboardUniversity,
	onboardUniversitiesBulk,
	onboardUniversity,
	bulkUpdateUniversityTokenDefaults,
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
	normalizeApprovalDefaults,
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
	normalizeRiskDefaults,
} from "./services/admin-risk.service.js";
import {
	normalizeComplianceDefaults,
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
	ensureDefaultAiSystems,
	normalizeInventoryDefaults,
} from "./services/admin-inventory.service.js";
import { cleanupSeededGovernanceMocks } from "./services/admin-governance-cleanup.service.js";
import { ensureDefaultAdmin } from "./services/bootstrap-admin.service.js";
import { UserModel } from "./db/models/User.js";
import { registerPortalRoutes } from "./routes/portal.js";

async function resolveUserId(authorization?: string): Promise<string | null> {
	const token = extractBearerToken(authorization);
	if (!token) return null;
	const payload = verifyAuthToken(token);
	return payload?.sub ?? null;
}

function datasetErrorMessage(error: unknown): string {
	if (error instanceof Error) {
		const msg = error.message?.trim();
		if (msg && msg !== "UnknownError") return msg;
		return "Could not save the dataset. Check the file and try again.";
	}
	return String(error);
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
	// Next static export only — never treat backend `dist/` (compiled JS) as the UI.
	const candidates = [
		resolve(repoRoot, "out"),
		resolve(repoRoot, "frontend", "out"),
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

	// Pretty university detail URLs: /super-admin/universities/:slug
	// Serve the static detail shell so client can read the slug from the path.
	const uniDetailMatch = normalized.match(/^\/super-admin\/universities\/([^/]+)$/);
	if (uniDetailMatch && uniDetailMatch[1] !== "detail") {
		const detailHtml = join(staticRoot, "super-admin/universities/detail/index.html");
		if (existsSync(detailHtml) && statSync(detailHtml).isFile()) {
			return detailHtml;
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
	await failOrphanedResearchJobs();
	const repoRoot = getRepoRoot();
	const staticRoot = resolveStaticRoot(repoRoot);
	const workflows = listWorkflows(ctx.backendRoot);

	const app = Fastify({
		logger: false,
		// Required behind nginx / Coolify reverse proxies
		trustProxy: true,
		// Base64 document/dataset uploads (MinIO-backed) can exceed Fastify's 1MB default
		bodyLimit: 25 * 1024 * 1024,
	});

	const corsOrigin = process.env.CORS_ORIGIN?.trim();
	await app.register(cors, {
		origin: corsOrigin
			? corsOrigin.split(",").map((value) => value.trim()).filter(Boolean)
			: true,
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
	} else {
		app.get("/", async () => ({
			ok: true,
			name: "GARIL AI API",
			version: ctx.version,
			health: "/api/health",
			websocket: "/ws",
		}));
	}

	app.get("/api/health", async () => {
		const s3: { enabled: boolean; ok: boolean | null; bucket?: string; endpoint?: string; error?: string } =
			{ enabled: s3Enabled(), ok: null };
		if (s3.enabled) {
			try {
				await assertS3Ready();
				s3.ok = true;
				s3.bucket = getS3Bucket();
				s3.endpoint = getS3Endpoint() ?? undefined;
			} catch (error) {
				s3.ok = false;
				s3.error = error instanceof Error ? error.message : String(error);
			}
		}
		return { ok: true, version: ctx.version, s3 };
	});

	/** Public: institutions that are onboarded and allowed to self-register (optionally by country). */
	app.get("/api/auth/universities", async (request) => {
		const query = request.query as { country?: string };
		return {
			universities: await listActiveUniversitiesForRegistration(query.country),
		};
	});

	/** Public: full university catalogue by country (UK, US, etc.). Nigeria uses the local catalogue on the client. */
	app.get("/api/auth/universities/catalogue", async (request, reply) => {
		const query = request.query as { country?: string };
		const country = query.country?.trim().toUpperCase() ?? "";
		if (!country) {
			return reply.code(400).send({ error: "Country is required." });
		}
		try {
			const { listUniversitiesForCountry } = await import("./services/world-universities.service.js");
			const universities = await listUniversitiesForCountry(country);
			return { universities };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/auth/register", async (request, reply) => {
		const body = request.body as {
			name?: string;
			email?: string;
			password?: string;
			department?: string;
			institution?: string;
			catalogueId?: string;
			country?: string;
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
				country: body.country,
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
			country?: string;
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
				country: body.country,
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
			assignmentInstructions?: string;
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

		const scope = normalizeResearchScope(body.scope?.trim());
		if (!scope) {
			return reply.code(400).send({
				error:
					"scope must be assignment, conference, dissertation, faculty, journal, proposal, report, thesis, or undergraduate_project.",
			});
		}

		const ideaId = body.idea.id?.trim() || body.idea.title.trim();

		try {
			const userId = await resolveUserId(request.headers.authorization);
			if (userId) {
				await assertStudentHasTokenBalance(userId);
			}
			const sourceContext = await buildResearchSourceContext(userId, body.sources);
			const hasSourceMaterial = Boolean(
				body.sources?.projectIds?.length ||
					body.sources?.documentIds?.length ||
					body.sources?.datasetIds?.length ||
					body.sources?.questionnaireIds?.length,
			);

			const result = await generateResearchOutline(
				{
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
					scope: scope,
					sourceContext,
					fast: hasSourceMaterial,
					assignmentInstructions: body.assignmentInstructions?.trim() || undefined,
				},
				{ signal: abortSignalFromRequest(request, reply) },
			);

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
					scope: scope,
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
			if (error instanceof Error && error.name === "AbortError") {
				if (!reply.sent) return reply.code(499).send({ error: "Request cancelled." });
				return;
			}
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

		const scope = normalizeResearchScope(body.scope?.trim());
		if (!scope) {
			return reply.code(400).send({
				error:
					"scope must be assignment, conference, dissertation, faculty, journal, proposal, report, thesis, or undergraduate_project.",
			});
		}

		try {
			const userId = await resolveUserId(request.headers.authorization);
			if (userId) {
				await assertStudentHasTokenBalance(userId);
			}
			const sourceContext = await buildResearchSourceContext(userId, body.sources);

			const result = await generateResearchIdeas(
				{
					disciplineLabel: body.disciplineLabel.trim(),
					topic: body.topic.trim(),
					scope: scope,
					sourceContext,
				},
				{ signal: abortSignalFromRequest(request, reply) },
			);

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
			if (error instanceof Error && error.name === "AbortError") {
				if (!reply.sent) return reply.code(499).send({ error: "Request cancelled." });
				return;
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(502).send({ error: message });
		}
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

	app.get("/api/research/saved", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Authentication required." });
		}
		const papers = await listSavedResearch(userId);
		return { papers };
	});

	app.post("/api/research/jobs", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Authentication required." });
		}
		const body = request.body as {
			prompt?: string;
			topic?: string;
			figureDocumentIds?: string[];
			sources?: {
				documentIds?: string[];
				datasetIds?: string[];
				questionnaireIds?: string[];
				noteIds?: string[];
				projectIds?: string[];
			};
		};
		if (!body.prompt?.trim()) {
			return reply.code(400).send({ error: "Prompt is required." });
		}
		try {
			const job = await startResearchPaperJob({
				ctx,
				userId,
				prompt: body.prompt,
				topic: body.topic,
				figureDocumentIds: body.figureDocumentIds,
				sources: body.sources,
			});
			return { job };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const conflict = message.includes("already generating");
			return reply.code(conflict ? 409 : 400).send({ error: message });
		}
	});

	app.get("/api/research/jobs/active", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Authentication required." });
		}
		const job = await getActiveResearchJob(userId);
		return { job };
	});

	app.get<{ Params: { id: string } }>("/api/research/jobs/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Authentication required." });
		}
		const job = await getResearchJobById(request.params.id, userId);
		if (!job) {
			return reply.code(404).send({ error: "Research job not found." });
		}
		return { job };
	});

	app.post<{ Params: { id: string } }>("/api/research/jobs/:id/cancel", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Authentication required." });
		}
		const job = await cancelResearchJob(request.params.id, userId);
		if (!job) {
			return reply.code(404).send({ error: "Research job not found." });
		}
		return { job };
	});

	app.get<{ Params: { id: string } }>("/api/research/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Authentication required." });
		}
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
			if (!userId) {
				return reply.code(401).send({ error: "Authentication required." });
			}
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
			sources?: {
				documentIds?: string[];
				datasetIds?: string[];
				questionnaireIds?: string[];
				noteIds?: string[];
				projectIds?: string[];
			};
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
			if (!userId) {
				return reply.code(401).send({ error: "Authentication required." });
			}
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
				sources: body.sources,
			});
			return { paper };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.delete("/api/research/saved", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Authentication required." });
		}
		const deleted = await deleteAllSavedResearch(userId);
		return { ok: true, deleted };
	});

	app.delete<{ Params: { id: string } }>("/api/research/saved/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) {
			return reply.code(401).send({ error: "Sign in to remove research saved to your account." });
		}
		const deleted = await deleteSavedResearch(request.params.id, userId);
		if (!deleted) {
			return reply.code(404).send({ error: "Saved research not found." });
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

		const scope = normalizeResearchScope(body.scope?.trim());
		if (!scope) {
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
				scope: scope,
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

		const scope = normalizeResearchScope(body.scope?.trim());
		if (
			!body.ideaId?.trim() ||
			!body.ideaTitle?.trim() ||
			!body.discipline?.trim() ||
			!body.topic?.trim() ||
			!body.outline?.trim() ||
			!scope
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
				scope: scope,
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
			notebookData?: unknown;
			progress?: number;
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
			const message = datasetErrorMessage(error);
			const status = message.includes("Sign in") ? 401 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	/** Direct-to-MinIO upload session (supports up to S3_MAX_UPLOAD_BYTES, default 2 GiB). */
	app.post("/api/research/datasets/upload-session", async (request, reply) => {
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
			fileSizeBytes?: number;
		};
		try {
			const session = await beginDatasetDirectUpload(userId, body);
			return session;
		} catch (error) {
			const message = datasetErrorMessage(error);
			const status = message.includes("Sign in") ? 401 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.post<{ Params: { id: string } }>(
		"/api/research/datasets/:id/complete-upload",
		async (request, reply) => {
			const userId = await resolveUserId(request.headers.authorization);
			if (!userId) return reply.code(401).send({ error: "Authentication required." });
			try {
				const dataset = await completeDatasetDirectUpload(request.params.id, userId);
				return { dataset };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const status = message.includes("Sign in")
					? 401
					: message.includes("not found")
						? 404
						: 400;
				return reply.code(status).send({ error: message });
			}
		},
	);

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
			documentIds?: string[];
			topic?: string;
		};
		try {
			const artifacts = await buildPaperVisualizationArtifacts(userId, body);
			return {
				artifacts: artifacts.artifacts,
				figureAppendix: artifacts.figureAppendix,
				hasSavedFigures: artifacts.hasSavedFigures,
				figureDocumentIds: artifacts.figureDocumentIds,
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

	app.get("/api/research/questionnaires", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const projectId = (request.query as { projectId?: string }).projectId;
		const questionnaires = await listQuestionnaires(userId, projectId);
		return { questionnaires };
	});

	app.post("/api/research/questionnaires", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = request.body as {
			projectId?: string;
			title?: string;
			description?: string;
			population?: string;
			sampleSize?: number;
			distributionNote?: string;
			items?: unknown;
			instrumentDocumentId?: string;
		};
		try {
			const questionnaire = await createQuestionnaire(userId, body);
			return { questionnaire };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("Sign in") ? 401 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.patch<{ Params: { id: string } }>("/api/research/questionnaires/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const body = (request.body ?? {}) as {
			title?: string;
			description?: string;
			population?: string;
			sampleSize?: number;
			distributionNote?: string;
			items?: unknown;
			instrumentDocumentId?: string | null;
		};
		try {
			const questionnaire = await updateQuestionnaire(request.params.id, userId, body);
			if (!questionnaire) return reply.code(404).send({ error: "Questionnaire not found." });
			return { questionnaire };
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			const status = message.includes("Sign in") ? 401 : 400;
			return reply.code(status).send({ error: message });
		}
	});

	app.post<{ Params: { id: string } }>(
		"/api/research/questionnaires/:id/import",
		async (request, reply) => {
			const userId = await resolveUserId(request.headers.authorization);
			if (!userId) return reply.code(401).send({ error: "Authentication required." });
			const body = (request.body ?? {}) as {
				fileName?: string;
				fileMime?: string;
				fileData?: string;
				columnMap?: Record<string, string>;
			};
			try {
				const questionnaire = await importQuestionnaireResponses(request.params.id, userId, body);
				return { questionnaire };
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				const status = message.includes("Sign in")
					? 401
					: message.includes("not found")
						? 404
						: 400;
				return reply.code(status).send({ error: message });
			}
		},
	);

	app.delete<{ Params: { id: string } }>("/api/research/questionnaires/:id", async (request, reply) => {
		const userId = await resolveUserId(request.headers.authorization);
		if (!userId) return reply.code(401).send({ error: "Authentication required." });
		const deleted = await deleteQuestionnaire(request.params.id, userId);
		if (!deleted) return reply.code(404).send({ error: "Questionnaire not found." });
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

	app.get<{ Params: { id: string } }>("/api/admin/users/:id", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const user = await getAdminUserById(request.params.id, scope);
			if (!user) return reply.code(404).send({ error: "User not found." });
			return { user };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Params: { id: string } }>("/api/admin/users/:id/governance-history", async (request, reply) => {
		try {
			const scope = await requireAdminScope(request.headers.authorization);
			const data = await getUserGovernanceHistory(request.params.id, scope);
			if (!data) return reply.code(404).send({ error: "User not found." });
			return data;
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

	app.get<{ Params: { id: string } }>("/api/admin/universities/:id", async (request, reply) => {
		try {
			await requireSuperAdmin(request.headers.authorization);
			const university = await getUniversityRecord(request.params.id);
			if (!university) return reply.code(404).send({ error: "University not found." });
			return { university };
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
				country?: string;
				status?: "active" | "inactive";
			};
			if (!body.catalogueId?.trim() || !body.name?.trim()) {
				return reply.code(400).send({ error: "catalogueId and name are required." });
			}
			const university = await onboardUniversity({
				catalogueId: body.catalogueId,
				name: body.name,
				country: body.country ?? "NG",
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

	app.post("/api/admin/universities/bulk", async (request, reply) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const body = request.body as {
				country?: string;
				status?: "active" | "inactive";
				universities?: Array<{ catalogueId?: string; name?: string }>;
			};
			const universities = (body.universities ?? [])
				.filter((u) => u.catalogueId?.trim() && u.name?.trim())
				.map((u) => ({ catalogueId: u.catalogueId!.trim(), name: u.name!.trim() }));
			if (universities.length === 0) {
				return reply.code(400).send({ error: "universities array with catalogueId and name is required." });
			}
			const result = await onboardUniversitiesBulk({
				country: body.country ?? "NG",
				status: body.status ?? "active",
				universities,
				onboardedBy: adminId,
			});
			await recordAuditEvent({
				action: "admin.universities_bulk_onboarded",
				category: "admin",
				actorId: adminId,
				summary: `Bulk onboarded ${(body.country ?? "NG").toUpperCase()}: ${result.created} created, ${result.updated} updated, ${result.failed} failed`,
				targetType: "university",
				severity: "medium",
				details: {
					country: (body.country ?? "NG").toUpperCase(),
					created: result.created,
					updated: result.updated,
					failed: result.failed,
					total: result.total,
				},
			});
			return { result };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	});

	app.post("/api/admin/universities/token-defaults", async (request, reply) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const body = request.body as {
				scope?: "all" | "country" | "university";
				country?: string;
				universityId?: string;
				defaultStudentTokens?: number | null;
				defaultLecturerTokens?: number | null;
			};
			if (!body.scope) {
				return reply.code(400).send({ error: "scope is required (all, country, or university)." });
			}
			const result = await bulkUpdateUniversityTokenDefaults({
				scope: body.scope,
				country: body.country,
				universityId: body.universityId,
				defaultStudentTokens: body.defaultStudentTokens,
				defaultLecturerTokens: body.defaultLecturerTokens,
			});
			await recordAuditEvent({
				action: "admin.university_token_defaults_bulk",
				category: "admin",
				actorId: adminId,
				summary:
					result.scope === "all"
						? `Set token defaults on all universities (${result.updated})`
						: result.scope === "country"
							? `Set token defaults on ${result.country} universities (${result.updated})`
							: `Set token defaults on university ${result.universityId}`,
				targetType: "university",
				targetId: result.universityId ?? result.country ?? "all",
				severity: "medium",
				details: {
					scope: result.scope,
					country: result.country,
					universityId: result.universityId,
					updated: result.updated,
					defaultStudentTokens: result.defaultStudentTokens,
					defaultLecturerTokens: result.defaultLecturerTokens,
				},
			});
			return { result };
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
			const body = request.body as Partial<{
				name: string;
				status: "active" | "inactive";
				defaultStudentTokens: number | null;
				defaultLecturerTokens: number | null;
			}>;
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
				details: {
					defaultStudentTokens: university.defaultStudentTokens,
					defaultLecturerTokens: university.defaultLecturerTokens,
				},
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

	const offboardUniversityHandler = async (
		request: { headers: { authorization?: string }; params: { id: string }; body: unknown; query: unknown },
		reply: { code: (status: number) => { send: (payload: unknown) => unknown } },
	) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const body = (request.body as { confirmName?: string } | null) ?? {};
			const confirmName =
				body.confirmName ??
				(request.query as { confirmName?: string }).confirmName ??
				"";
			const result = await offboardUniversity(request.params.id, confirmName);
			await recordAuditEvent({
				action: "admin.university_offboarded",
				category: "admin",
				actorId: adminId,
				summary: result.hardDeleted
					? `Hard-deleted university ${request.params.id}`
					: `Offboarded university ${result.university?.name ?? request.params.id} (suspended ${result.suspendedUsers} users)`,
				targetType: "university",
				targetId: request.params.id,
				severity: "high",
			});
			return result;
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(400).send({ error: message });
		}
	};

	app.delete<{ Params: { id: string } }>(
		"/api/admin/universities/:id",
		offboardUniversityHandler,
	);
	app.post<{ Params: { id: string } }>(
		"/api/admin/universities/:id/offboard",
		offboardUniversityHandler,
	);

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
				suspensionReason: string | null;
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
			const body = request.body as {
				ids?: string[];
				status?: "active" | "inactive" | "suspended";
				suspensionReason?: string;
			};
			if (!body.ids?.length || !body.status) {
				return reply.code(400).send({ error: "ids and status are required." });
			}
			return await bulkUpdateUserStatus(body.ids, body.status, scope, body.suspensionReason);
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
			const body = request.body as {
				reset?: boolean;
				tokensUsed?: number;
				tokenAllowance?: number | null;
			};
			let record;
			if (body.reset) {
				record = await resetUserTokens(request.params.id, scope);
			} else if (body.tokenAllowance !== undefined) {
				record = await setUserTokenAllowance(request.params.id, body.tokenAllowance, scope);
			} else if (body.tokensUsed !== undefined) {
				record = await setUserTokensUsed(request.params.id, body.tokensUsed, scope);
			} else {
				return reply
					.code(400)
					.send({ error: "Provide reset: true, tokensUsed, or tokenAllowance." });
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

	app.get("/api/admin/research/stats", async (request, reply) => {
		try {
			await requireSuperAdmin(request.headers.authorization);
			const query = request.query as { universityId?: string };
			const stats = await getAdminResearchStats(query.universityId || null);
			return { stats };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/research/papers", async (request, reply) => {
		try {
			await requireSuperAdmin(request.headers.authorization);
			const query = request.query as { universityId?: string; limit?: string };
			const papers = await listAdminResearchPapers({
				universityId: query.universityId || null,
				limit: query.limit ? Number(query.limit) : undefined,
			});
			return { papers };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get<{ Params: { id: string } }>("/api/admin/research/papers/:id", async (request, reply) => {
		try {
			await requireSuperAdmin(request.headers.authorization);
			const paper = await getAdminResearchPaper(request.params.id);
			if (!paper) return reply.code(404).send({ error: "Research paper not found." });
			return { paper };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.delete<{ Params: { id: string } }>("/api/admin/research/papers/:id", async (request, reply) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const ok = await deleteAdminResearchPaper(request.params.id, adminId);
			if (!ok) return reply.code(404).send({ error: "Research paper not found." });
			return { ok: true };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.post("/api/admin/research/papers/bulk-delete", async (request, reply) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const body = request.body as { ids?: string[] };
			if (!body.ids?.length) return reply.code(400).send({ error: "ids are required." });
			const deleted = await bulkDeleteAdminResearchPapers(body.ids, adminId);
			return { deleted };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.get("/api/admin/research/uploads", async (request, reply) => {
		try {
			await requireSuperAdmin(request.headers.authorization);
			const query = request.query as {
				universityId?: string;
				limit?: string;
				kind?: string;
			};
			const kindRaw = query.kind?.trim();
			const kind =
				kindRaw === "document" || kindRaw === "dataset" || kindRaw === "all"
					? kindRaw
					: "all";
			const uploads = await listAdminResearchUploads({
				universityId: query.universityId || null,
				limit: query.limit ? Number(query.limit) : undefined,
				kind,
			});
			return { uploads };
		} catch (error) {
			if (error instanceof AdminRequiredError) {
				return reply.code(error.statusCode).send({ error: error.message });
			}
			const message = error instanceof Error ? error.message : String(error);
			return reply.code(500).send({ error: message });
		}
	});

	app.delete<{ Params: { kind: string; id: string } }>(
		"/api/admin/research/uploads/:kind/:id",
		async (request, reply) => {
			try {
				const adminId = await requireSuperAdmin(request.headers.authorization);
				const kind = request.params.kind;
				if (kind !== "document" && kind !== "dataset") {
					return reply.code(400).send({ error: "kind must be document or dataset." });
				}
				const ok = await deleteAdminResearchUpload(
					request.params.id,
					kind as AdminResearchUploadKind,
					adminId,
				);
				if (!ok) return reply.code(404).send({ error: "Upload not found." });
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

	app.post("/api/admin/research/uploads/bulk-delete", async (request, reply) => {
		try {
			const adminId = await requireSuperAdmin(request.headers.authorization);
			const body = request.body as { items?: Array<{ id: string; kind: AdminResearchUploadKind }> };
			if (!body.items?.length) return reply.code(400).send({ error: "items are required." });
			const deleted = await bulkDeleteAdminResearchUploads(body.items, adminId);
			return { deleted };
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
			}, scope, scope.actorId);
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
				audience?: "management" | "senate" | "both" | "external_auditors";
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


	await registerPortalRoutes(app);

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
	if (staticRoot) {
		console.log(`GARIL AI (API + UI): http://0.0.0.0:${port}`);
	} else {
		console.log(`GARIL AI API: http://0.0.0.0:${port}  (health: /api/health)`);
	}

	const shutdown = async () => {
		await chat.abort();
		await app.close();
		await disconnectMongo();
	};

	process.on("SIGINT", () => void shutdown().then(() => process.exit(0)));
	process.on("SIGTERM", () => void shutdown().then(() => process.exit(0)));
}
