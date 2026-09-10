import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import { AppError, ValidationError } from "../lib/portal-errors.js";
import {
	isStudentRole,
	isSupervisorRole,
	requirePortalActor,
	requireStudent,
	requireSupervisor,
	type PortalActor,
} from "../lib/portal-auth.js";
import { PROJECT_TYPE_VALUES, type ProjectType } from "../lib/portal-project-types.js";
import { detectUploadKind, extractUploadedDocument } from "../lib/portal-docs/extract.js";
import { analyseDocumentIntoSections } from "../lib/portal-docs/analyse-document.js";
import { asSingleDocumentPage } from "../lib/portal-docs/split-sections.js";
import { isSinglePageProjectType } from "../lib/portal-project-types.js";
import { createAIProvider } from "../lib/portal-ai/provider.js";
import { isS3Enabled } from "../config/env.js";
import { decodeDataUrlOrBase64, storeAttachment } from "../services/attachment-storage.service.js";
import { objectUrl } from "../services/s3.service.js";
import { projectService } from "../services/portal/portal-project.service.js";
import { chapterService } from "../services/portal/portal-chapter.service.js";
import { assignmentBriefService } from "../services/portal/portal-assignment.service.js";
import { notificationService } from "../services/portal/portal-notification.service.js";
import { aiReviewService } from "../services/portal/portal-ai.service.js";
import { aiChatService } from "../services/portal/portal-chat.service.js";
import { userRepository } from "../services/portal/portal-users.js";
import { deductStudentTokens } from "../services/student-token.service.js";
import { assertUniversityFeature } from "../lib/assert-university-feature.js";
import { UniversityFeatureDisabledError } from "../lib/university-features.js";

function ok(reply: FastifyReply, data: unknown, status = 200) {
	return reply.code(status).send({ success: true, data });
}

function fail(reply: FastifyReply, error: unknown) {
	if (error instanceof UniversityFeatureDisabledError) {
		return reply.code(403).send({
			success: false,
			error: { code: "MODULE_DISABLED", message: error.message },
		});
	}
	if (error instanceof AppError) {
		return reply.code(error.statusCode).send({
			success: false,
			error: { code: error.code, message: error.message, details: error.details },
		});
	}
	const message = error instanceof Error ? error.message : String(error);
	return reply.code(400).send({
		success: false,
		error: { code: "BAD_REQUEST", message },
	});
}

async function actorOf(request: FastifyRequest): Promise<PortalActor> {
	return requirePortalActor(request.headers.authorization);
}

async function assertPortalModulesForActor(
	actor: PortalActor,
	kind: "supervision" | "assessment" | "either",
) {
	if (kind === "assessment") {
		await assertUniversityFeature(actor.universityId, "studentAssessment");
		return;
	}
	if (kind === "supervision") {
		await assertUniversityFeature(actor.universityId, "supervisionAssistant");
		return;
	}
	try {
		await assertUniversityFeature(actor.universityId, "supervisionAssistant");
	} catch (err) {
		if (!(err instanceof UniversityFeatureDisabledError)) throw err;
		await assertUniversityFeature(actor.universityId, "studentAssessment");
	}
}

function asProjectType(value: unknown): ProjectType {
	if (typeof value === "string" && (PROJECT_TYPE_VALUES as string[]).includes(value)) {
		return value as ProjectType;
	}
	throw new ValidationError("Select a valid project type");
}

export async function registerPortalRoutes(app: FastifyInstance): Promise<void> {
	app.get("/api/portal/supervisors", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			await assertPortalModulesForActor(actor, "either");
			const universityId = actor.universityId;
			const [university, supervisors] = await Promise.all([
				userRepository.getUniversity(universityId),
				userRepository.listSupervisors(universityId),
			]);
			return ok(reply, {
				university: {
					id: universityId || "",
					name: university?.name || "Your university",
					slug: university?.slug,
					country: university?.country,
				},
				supervisors: supervisors.map((s) => ({
					id: String(s._id),
					name: s.name,
					email: s.email,
					role: s.role,
				})),
			});
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get("/api/portal/projects", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			const query = request.query as { type?: string };
			if (query.type === "assignment") {
				await assertPortalModulesForActor(actor, "assessment");
			} else {
				await assertPortalModulesForActor(actor, "either");
			}
			if (isStudentRole(actor.role)) {
				return ok(reply, await projectService.listForStudent(actor.tenantId, actor.userId));
			}
			if (isSupervisorRole(actor.role)) {
				if (query.type === "assignment") {
					return ok(
						reply,
						await projectService.listAssignmentsForSupervisor(actor.tenantId, actor.userId),
					);
				}
				return ok(reply, await projectService.listForSupervisor(actor.tenantId, actor.userId));
			}
			throw new ValidationError("Unsupported role for projects");
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.post("/api/portal/projects", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			if (!actor.universityId) {
				throw new ValidationError(
					"Your account is not linked to a university. Contact your administrator.",
				);
			}
			const body = (request.body ?? {}) as Record<string, unknown>;
			const title = String(body.title || "").trim();
			if (title.length < 3) throw new ValidationError("Title is required");
			const projectType = asProjectType(body.projectType);
			await assertPortalModulesForActor(
				actor,
				isSinglePageProjectType(projectType) ? "assessment" : "supervision",
			);
			const supervisorId = String(body.supervisorId || "");
			if (!/^[a-f\d]{24}$/i.test(supervisorId)) {
				throw new ValidationError("Select a supervisor");
			}
			const project = await projectService.create(actor.universityId, actor.userId, {
				title,
				projectType,
				supervisorId,
				topic: typeof body.topic === "string" ? body.topic : undefined,
				abstract: typeof body.abstract === "string" ? body.abstract : undefined,
				studentMatNo: typeof body.studentMatNo === "string" ? body.studentMatNo : undefined,
				courseYear: typeof body.courseYear === "string" ? body.courseYear : undefined,
				courseName: typeof body.courseName === "string" ? body.courseName : undefined,
				assignmentBriefId:
					typeof body.assignmentBriefId === "string" ? body.assignmentBriefId : undefined,
			});
			return ok(reply, project, 201);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get<{ Params: { id: string } }>("/api/portal/projects/:id", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			if (isStudentRole(actor.role)) {
				const owned = await projectService.getOwned(actor.tenantId, request.params.id, actor.userId);
				const [enriched] = await projectService.enrichWithBriefs(actor.tenantId, [
					typeof owned.toObject === "function" ? owned.toObject() : owned,
				]);
				return ok(reply, enriched);
			}
			requireSupervisor(actor);
			return ok(
				reply,
				await projectService.getForSupervisor(actor.tenantId, request.params.id, actor.userId),
			);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.delete<{ Params: { id: string } }>("/api/portal/projects/:id", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			return ok(
				reply,
				await projectService.deleteOwned(actor.tenantId, request.params.id, actor.userId),
			);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get<{ Params: { id: string } }>("/api/portal/projects/:id/pages", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			const project = await projectService.get(actor.tenantId, request.params.id);
			return ok(reply, (project as { pages?: unknown }).pages ?? []);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.post<{ Params: { id: string } }>("/api/portal/projects/:id/pages", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			const body = (request.body ?? {}) as { title?: string };
			const title = String(body.title || "").trim();
			if (!title) throw new ValidationError("Page title is required");
			return ok(
				reply,
				await projectService.addPage(actor.tenantId, request.params.id, actor.userId, { title }),
				201,
			);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get<{ Params: { id: string; pageId: string } }>(
		"/api/portal/projects/:id/pages/:pageId",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				if (isSupervisorRole(actor.role)) {
					return ok(
						reply,
						await projectService.getPageForSupervisor(
							actor.tenantId,
							request.params.id,
							request.params.pageId,
							actor.userId,
						),
					);
				}
				const project = await projectService.getOwned(
					actor.tenantId,
					request.params.id,
					actor.userId,
				);
				const page = project.pages?.id(request.params.pageId);
				if (!page) throw new ValidationError("Page not found");
				return ok(reply, {
					project,
					page: typeof page.toObject === "function" ? page.toObject() : page,
				});
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.put<{ Params: { id: string; pageId: string } }>(
		"/api/portal/projects/:id/pages/:pageId",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireStudent(actor);
				const body = (request.body ?? {}) as { title?: string; content?: string };
				return ok(
					reply,
					await projectService.updatePage(
						actor.tenantId,
						request.params.id,
						request.params.pageId,
						actor.userId,
						body,
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.delete<{ Params: { id: string; pageId: string } }>(
		"/api/portal/projects/:id/pages/:pageId",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireStudent(actor);
				return ok(
					reply,
					await projectService.deletePage(
						actor.tenantId,
						request.params.id,
						request.params.pageId,
						actor.userId,
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string; pageId: string } }>(
		"/api/portal/projects/:id/pages/:pageId/review",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				const body = (request.body ?? {}) as {
					action?: "approve" | "needs_revision";
					remark?: string;
					annotatedHtml?: string;
				};
				if (body.action !== "approve" && body.action !== "needs_revision") {
					throw new ValidationError("Review action must be approve or needs_revision");
				}
				return ok(
					reply,
					await projectService.reviewPage(
						actor.tenantId,
						request.params.id,
						request.params.pageId,
						actor.userId,
						{
							action: body.action,
							remark: body.remark,
							annotatedHtml: body.annotatedHtml,
						},
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string; pageId: string } }>(
		"/api/portal/projects/:id/pages/:pageId/ai-summary",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				const result = await aiReviewService.summarizePage(
					actor.tenantId,
					request.params.id,
					request.params.pageId,
					actor.userId,
				);
				await deductStudentTokens(actor.userId, 800).catch(() => null);
				return ok(reply, result);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/projects/:id/topic/submit",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireStudent(actor);
				return ok(
					reply,
					await projectService.submitTopic(actor.tenantId, request.params.id, actor.userId),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/projects/:id/topic/approve",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				return ok(reply, await projectService.approveTopic(actor.tenantId, request.params.id));
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/projects/:id/attach-brief",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				const body = (request.body ?? {}) as { assignmentBriefId?: string };
				if (!body.assignmentBriefId) throw new ValidationError("assignmentBriefId is required");
				return ok(
					reply,
					await projectService.attachBrief(
						actor.tenantId,
						request.params.id,
						actor.userId,
						body.assignmentBriefId,
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>("/api/portal/projects/:id/score", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireSupervisor(actor);
			const body = (request.body ?? {}) as {
				score?: number;
				acceptAiScore?: boolean;
				scoreNote?: string;
				remark?: string;
				annotatedHtml?: string;
				criterionScores?: Array<{ name: string; score: number; maxMarks: number }>;
			};
			return ok(
				reply,
				await projectService.scoreAssignment(
					actor.tenantId,
					request.params.id,
					actor.userId,
					body,
				),
			);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.post<{ Params: { id: string } }>(
		"/api/portal/projects/:id/import-document",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireStudent(actor);
				const body = (request.body ?? {}) as {
					fileName?: string;
					mimeType?: string;
					data?: string;
					mode?: string;
				};
				if (!body.fileName || !body.data) {
					throw new ValidationError("Upload a Word (.docx) or PDF file");
				}
				const kind = detectUploadKind(body.fileName, body.mimeType);
				const { buffer } = decodeDataUrlOrBase64(body.data);
				if (buffer.byteLength > 12 * 1024 * 1024) {
					throw new ValidationError("File is too large (max 12 MB)");
				}
				const owned = await projectService.getOwned(
					actor.tenantId,
					request.params.id,
					actor.userId,
				);
				const singlePage = isSinglePageProjectType(String(owned.projectType));
				const { text, html } = await extractUploadedDocument(kind, buffer);
				const { sections } = singlePage
					? {
							sections: asSingleDocumentPage(text, html, "Assignment"),
						}
					: await analyseDocumentIntoSections(createAIProvider(), text, html);
				if (sections.length === 0) {
					throw new ValidationError("Could not find sections in this document");
				}
				const mode = body.mode === "replace" ? "replace" : "append";
				const project = await projectService.importPages(
					actor.tenantId,
					request.params.id,
					actor.userId,
					{ mode, sections },
				);
				return ok(reply, project, 201);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.get<{ Params: { id: string } }>("/api/portal/projects/:id/export", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			const pack = await projectService.exportPackage(
				actor.tenantId,
				request.params.id,
				actor.userId,
			);
			return ok(reply, pack);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.post<{ Params: { id: string } }>("/api/portal/projects/:id/images", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			await projectService.getOwned(actor.tenantId, request.params.id, actor.userId);
			const body = (request.body ?? {}) as { mimeType?: string; data?: string };
			if (!body.data) throw new ValidationError("Image data is required");
			const { buffer, mime } = decodeDataUrlOrBase64(body.data);
			if (buffer.byteLength > 5 * 1024 * 1024) {
				throw new ValidationError("Image is too large (max 5 MB)");
			}
			const type = mime || body.mimeType || "image/png";
			if (isS3Enabled()) {
				const stored = await storeAttachment({
					userId: actor.userId,
					kind: "assets",
					id: request.params.id,
					fileName: `editor-${Date.now()}.png`,
					fileMime: type,
					fileData: body.data,
				});
				return ok(reply, { url: objectUrl(stored.storageKey) }, 201);
			}
			return ok(reply, { url: `data:${type};base64,${buffer.toString("base64")}` }, 201);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.post<{ Params: { id: string } }>("/api/portal/projects/:id/ai/chat", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			const body = (request.body ?? {}) as { message?: string };
			const message = String(body.message || "").trim();
			if (!message) throw new ValidationError("Message is required");
			const result = await aiChatService.chat(
				actor.tenantId,
				request.params.id,
				actor.userId,
				message,
			);
			await deductStudentTokens(actor.userId, 200).catch(() => null);
			return ok(reply, result);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get<{ Params: { id: string } }>(
		"/api/portal/projects/:id/chapters",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				return ok(reply, await chapterService.listForProject(actor.tenantId, request.params.id));
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/projects/:id/chapters/submit-from-page",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireStudent(actor);
				const body = (request.body ?? {}) as {
					chapterNumber?: number;
					title?: string;
					html?: string;
					wordCount?: number;
				};
				if (!body.chapterNumber || !body.title || !body.html) {
					throw new ValidationError("chapterNumber, title, and html are required");
				}
				const result = await chapterService.submitFromPage(
					actor.tenantId,
					request.params.id,
					actor.userId,
					{
						chapterNumber: Number(body.chapterNumber),
						title: body.title,
						html: body.html,
						wordCount: body.wordCount,
					},
				);
				await deductStudentTokens(actor.userId, 400).catch(() => null);
				return ok(reply, result, 201);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/chapters/:id/approve",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				return ok(
					reply,
					await chapterService.approve(actor.tenantId, request.params.id, actor.userId),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/chapters/:id/reject",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				const body = (request.body ?? {}) as {
					reason?: string;
					needsRevision?: boolean;
					annotatedHtml?: string;
				};
				const reason = String(body.reason || "").trim();
				if (reason.length < 3) throw new ValidationError("Add a revision remark");
				return ok(
					reply,
					await chapterService.reject(
						actor.tenantId,
						request.params.id,
						reason,
						body.needsRevision !== false,
						body.annotatedHtml,
						{ actorId: actor.userId },
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/chapters/:id/save-review",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				const body = (request.body ?? {}) as {
					remark?: string;
					annotatedHtml?: string;
					aiReviewerReport?: Record<string, unknown> | null;
				};
				return ok(
					reply,
					await chapterService.saveSupervisorReview(
						actor.tenantId,
						request.params.id,
						actor.userId,
						body,
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.post<{ Params: { id: string } }>(
		"/api/portal/chapters/:id/ai-reviewer",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				const result = await aiReviewService.analyzeChapterWeaknesses(
					actor.tenantId,
					request.params.id,
					actor.userId,
				);
				await deductStudentTokens(actor.userId, 800).catch(() => null);
				return ok(reply, result);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.get<{ Params: { id: string } }>(
		"/api/portal/chapters/:id/versions",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				return ok(reply, await chapterService.listVersions(actor.tenantId, request.params.id));
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.get<{ Params: { id: string } }>("/api/portal/versions/:id", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			return ok(reply, await chapterService.getVersion(actor.tenantId, request.params.id));
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get<{ Params: { id: string } }>("/api/portal/chapters/:id", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			if (isSupervisorRole(actor.role)) {
				return ok(
					reply,
					await chapterService.getForSupervisorReview(
						actor.tenantId,
						request.params.id,
						actor.userId,
					),
				);
			}
			return ok(reply, await chapterService.listVersions(actor.tenantId, request.params.id));
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get("/api/portal/supervisor/reviews", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireSupervisor(actor);
			return ok(
				reply,
				await chapterService.listPendingForSupervisor(actor.tenantId, actor.userId),
			);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get("/api/portal/assignment-briefs", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			await assertPortalModulesForActor(actor, "assessment");
			const query = request.query as {
				lecturerId?: string;
				courseYear?: string;
				courseName?: string;
			};
			if (isStudentRole(actor.role)) {
				if (!actor.universityId) return ok(reply, []);
				const lecturerId = query.lecturerId || "";
				if (!lecturerId) return ok(reply, []);
				return ok(
					reply,
					await assignmentBriefService.listPublishedForStudent(
						actor.universityId,
						lecturerId,
						{
							courseYear: query.courseYear,
							courseName: query.courseName,
						},
					),
				);
			}
			requireSupervisor(actor);
			return ok(reply, await assignmentBriefService.listForLecturer(actor.tenantId, actor.userId));
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.post("/api/portal/assignment-briefs", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireSupervisor(actor);
			await assertPortalModulesForActor(actor, "assessment");
			const body = (request.body ?? {}) as Record<string, unknown>;
			const title = String(body.title || "").trim();
			if (title.length < 3) throw new ValidationError("Title is required");
			return ok(
				reply,
				await assignmentBriefService.create(actor.tenantId, actor.userId, {
					title,
					instructions: typeof body.instructions === "string" ? body.instructions : "",
					requiredItems: Array.isArray(body.requiredItems)
						? body.requiredItems.map((item) => String(item))
						: [],
					wordCountMin: body.wordCountMin as number | null | undefined,
					wordCountMax: body.wordCountMax as number | null | undefined,
					maxScore: typeof body.maxScore === "number" ? body.maxScore : 100,
					rubric: Array.isArray(body.rubric)
						? (body.rubric as Array<{ name: string; maxMarks: number }>)
						: [],
					dueAt: (body.dueAt as string | null | undefined) ?? null,
					allowLateSubmission: body.allowLateSubmission !== false,
					courseName: typeof body.courseName === "string" ? body.courseName : "",
					courseYear: typeof body.courseYear === "string" ? body.courseYear : "",
					status: body.status === "published" ? "published" : "draft",
				}),
				201,
			);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get<{ Params: { id: string } }>(
		"/api/portal/assignment-briefs/:id",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				if (isSupervisorRole(actor.role)) {
					const brief = await assignmentBriefService.getForLecturer(
						actor.tenantId,
						request.params.id,
						actor.userId,
					);
					return ok(reply, brief);
				}
				return ok(reply, await assignmentBriefService.get(actor.tenantId, request.params.id));
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.patch<{ Params: { id: string } }>(
		"/api/portal/assignment-briefs/:id",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				const body = (request.body ?? {}) as Record<string, unknown>;
				return ok(
					reply,
					await assignmentBriefService.update(
						actor.tenantId,
						request.params.id,
						actor.userId,
						body,
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.delete<{ Params: { id: string } }>(
		"/api/portal/assignment-briefs/:id",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				return ok(
					reply,
					await assignmentBriefService.remove(actor.tenantId, request.params.id, actor.userId),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.get<{ Params: { id: string } }>(
		"/api/portal/assignment-briefs/:id/submissions",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				requireSupervisor(actor);
				return ok(
					reply,
					await assignmentBriefService.listSubmissions(
						actor.tenantId,
						request.params.id,
						actor.userId,
					),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.get("/api/portal/feedback", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			const query = request.query as { projectId?: string };
			if (query.projectId) {
				return ok(reply, await aiReviewService.listByProject(actor.tenantId, query.projectId));
			}
			requireStudent(actor);
			return ok(reply, await aiReviewService.listForStudent(actor.tenantId, actor.userId));
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get("/api/portal/notifications", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			const items = await notificationService.listForUser(actor.tenantId, actor.userId);
			const unreadCount = await notificationService.unreadCount(actor.tenantId, actor.userId);
			return ok(reply, { items, unreadCount });
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.patch("/api/portal/notifications", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			return ok(reply, await notificationService.markAllRead(actor.tenantId, actor.userId));
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.post<{ Params: { id: string } }>(
		"/api/portal/notifications/:id/read",
		async (request, reply) => {
			try {
				const actor = await actorOf(request);
				return ok(
					reply,
					await notificationService.markRead(actor.tenantId, actor.userId, request.params.id),
				);
			} catch (error) {
				return fail(reply, error);
			}
		},
	);

	app.get("/api/portal/deadlines", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireStudent(actor);
			return ok(
				reply,
				await projectService.listDeadlinesForStudent(actor.tenantId, actor.userId),
			);
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get("/api/portal/analytics/overview", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireSupervisor(actor);
			const [projects, assignments, pending, briefs] = await Promise.all([
				projectService.listForSupervisor(actor.tenantId, actor.userId),
				projectService.listAssignmentsForSupervisor(actor.tenantId, actor.userId),
				chapterService.listPendingForSupervisor(actor.tenantId, actor.userId),
				assignmentBriefService.listForLecturer(actor.tenantId, actor.userId),
			]);
			const all = [...projects, ...assignments] as Array<{
				progressPercent?: number;
				topicStatus?: string;
				status?: string;
				studentId?: unknown;
				student?: { id?: string };
			}>;
			const studentIds = new Set<string>();
			for (const project of projects as Array<{
				studentId?: unknown;
				student?: { id?: string };
			}>) {
				const id = String(project.student?.id || project.studentId || "");
				if (id) studentIds.add(id);
			}
			const buckets = { low: 0, mid: 0, high: 0 };
			for (const project of all) {
				const pct = Number(project.progressPercent || 0);
				if (pct >= 70) buckets.high += 1;
				else if (pct >= 30) buckets.mid += 1;
				else buckets.low += 1;
			}
			return ok(reply, {
				projectCount: projects.length,
				assignmentCount: briefs.length,
				submissionCount: assignments.length,
				studentCount: studentIds.size,
				pendingReviews: pending.length,
				progressBuckets: buckets,
				topicPending: all.filter((p) => p.topicStatus === "submitted").length,
			});
		} catch (error) {
			return fail(reply, error);
		}
	});

	app.get("/api/portal/students", async (request, reply) => {
		try {
			const actor = await actorOf(request);
			requireSupervisor(actor);
			const projects = await projectService.listForSupervisor(actor.tenantId, actor.userId);
			const assignments = await projectService.listAssignmentsForSupervisor(
				actor.tenantId,
				actor.userId,
			);
			const byStudent = new Map<
				string,
				{ id: string; name: string; email: string; projects: unknown[]; progress: number }
			>();
			for (const project of [...projects, ...assignments] as Array<{
				student?: { id?: string; name?: string; email?: string };
				progressPercent?: number;
			}>) {
				const id = String(project.student?.id || "");
				if (!id) continue;
				const existing = byStudent.get(id) || {
					id,
					name: project.student?.name || "Student",
					email: project.student?.email || "",
					projects: [],
					progress: 0,
				};
				existing.projects.push(project);
				existing.progress = Math.round(
					((existing.progress * (existing.projects.length - 1)) +
						Number(project.progressPercent || 0)) /
						existing.projects.length,
				);
				byStudent.set(id, existing);
			}
			return ok(reply, [...byStudent.values()]);
		} catch (error) {
			return fail(reply, error);
		}
	});
}
