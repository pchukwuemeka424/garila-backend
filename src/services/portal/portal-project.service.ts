import { NotFoundError, ForbiddenError, ValidationError } from "../../lib/portal-errors.js";
import { ProjectStage } from "../../lib/portal-enums.js";
import {
  getSectionsForType,
  isSinglePageProjectType,
  type ProjectType,
} from "../../lib/portal-project-types.js";
import { userRepository } from "./portal-users.js";
import { chapterRepository } from "./portal-chapter.repo.js";
import { notificationService } from "./portal-notification.service.js";
import { assignmentBriefRepository } from "./portal-assignment.repo.js";
import { projectRepository } from "./portal-project.repo.js";
import type {
  AddPageInput,
  CreateProjectInput,
  ImportPagesInput,
  ReviewPageInput,
  SaveSectionsInput,
  ScoreAssignmentInput,
  UpdatePageInput,
} from "./portal-dto.js";

function serializeBrief(brief: unknown) {
  if (!brief) return null;
  const doc = brief as { toObject?: () => Record<string, unknown> };
  if (typeof doc.toObject === "function") return doc.toObject();
  return { ...(brief as Record<string, unknown>) };
}

function stripRemarkHtml(value: string) {
  return String(value || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function serializeProject(project: unknown) {
  const doc = project as {
    toObject?: () => Record<string, unknown>;
    sections?: Map<string, string> | Record<string, string>;
  };
  const obj =
    typeof doc.toObject === "function"
      ? doc.toObject()
      : { ...(project as Record<string, unknown>) };
  const sections = doc.sections;
  if (sections instanceof Map) {
    obj.sections = Object.fromEntries(sections.entries());
  }
  return obj;
}

function normalizeProgressTitle(title: string) {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

function isChapterApprovedStatus(status: string) {
  return status === "approved" || status === "locked";
}

/**
 * Approval % = approved writing chapters ÷ planned chapters (pages).
 * A slot counts as approved when its chapter is approved/locked OR its page was
 * approved by the supervisor (page review path).
 */
function applyChapterApprovalProgress(
  project: {
    pages?: Array<{ title?: string; reviewStatus?: string }>;
    progressPercent?: number;
  },
  chapters: Array<{ title?: string; status: string }>,
) {
  const pages = Array.isArray(project.pages) ? [...project.pages] : [];
  const chapterByTitle = new Map(
    chapters.map((c) => [normalizeProgressTitle(String(c.title || "")), c]),
  );

  if (pages.length > 0) {
    let approved = 0;
    for (const page of pages) {
      const key = normalizeProgressTitle(String(page.title || ""));
      const chapter = chapterByTitle.get(key);
      const chapterOk = chapter
        ? isChapterApprovedStatus(String(chapter.status))
        : false;
      const pageOk = page.reviewStatus === "approved";
      if (chapterOk || pageOk) approved += 1;
    }
    project.progressPercent = Math.round((approved / pages.length) * 100);
    return {
      approved,
      total: pages.length,
      percent: project.progressPercent,
    };
  }

  const approved = chapters.filter((c) =>
    isChapterApprovedStatus(String(c.status)),
  ).length;
  const total = chapters.length;
  project.progressPercent =
    total === 0 ? 0 : Math.round((approved / total) * 100);
  return { approved, total, percent: project.progressPercent };
}

async function syncAndPersistApprovalProgress(
  tenantId: string,
  project: {
    _id: unknown;
    pages?: Array<{ title?: string; reviewStatus?: string }>;
    progressPercent?: number;
    save: () => Promise<unknown>;
  },
) {
  const chapters = await chapterRepository.listByProject(
    tenantId,
    String(project._id),
  );
  const before = project.progressPercent ?? 0;
  const stats = applyChapterApprovalProgress(project, chapters);
  if (stats.percent !== before) {
    await project.save();
  }
  return stats;
}

export const projectService = {
  /** Creates a project; student adds writing pages afterward.
   * Assignments seed a single empty writing page (no chapter template). */
  async create(tenantId: string, studentId: string, input: CreateProjectInput) {
    const supervisor = await userRepository.findSupervisorInUniversity(
      tenantId,
      input.supervisorId,
    );
    if (!supervisor) {
      throw new ValidationError(
        "Selected supervisor was not found in your university",
      );
    }

    const initialPages = isSinglePageProjectType(input.projectType)
      ? getSectionsForType(input.projectType as ProjectType).map(
          (section, order) => ({
            title: section.label,
            content: "",
            order,
          }),
        )
      : [];

    const isAssignment = input.projectType === "assignment";
    const studentMatNo = isAssignment ? (input.studentMatNo || "").trim() : "";
    let courseYear = isAssignment ? (input.courseYear || "").trim() : "";
    let courseName = isAssignment ? (input.courseName || "").trim() : "";

    let assignmentBriefId: string | undefined;
    if (isAssignment && input.assignmentBriefId) {
      const brief = await assignmentBriefRepository.findById(
        tenantId,
        input.assignmentBriefId,
      );
      if (!brief || brief.status !== "published") {
        throw new ValidationError(
          "Selected assignment brief was not found or is not published",
        );
      }
      if (String(brief.lecturerId) !== input.supervisorId) {
        throw new ValidationError(
          "Assignment brief must belong to the selected lecturer",
        );
      }
      assignmentBriefId = String(brief._id);
      if (!courseName && brief.courseName) {
        courseName = String(brief.courseName).trim();
      }
      if (!courseYear && brief.courseYear) {
        courseYear = String(brief.courseYear).trim();
      }
    }

    const project = await projectRepository.create({
      tenantId,
      studentId,
      title: input.title,
      topic: input.topic || input.title,
      abstract: input.abstract || "",
      projectType: input.projectType,
      supervisorId: input.supervisorId,
      studentMatNo,
      courseYear,
      courseName,
      ...(assignmentBriefId ? { assignmentBriefId } : {}),
      pages: initialPages,
      sections: {},
    });

    const student = await userRepository.findById(tenantId, studentId);
    const studentName = student?.name || "A student";
    try {
      await notificationService.create(tenantId, input.supervisorId, {
        type: "project.assigned",
        title: "New supervisee",
        body: `${studentName} selected you as supervisor for “${input.title}”.`,
        data: {
          projectId: String(project._id),
          studentId,
        },
      });
    } catch {
      // Assignment is already saved; notification failure must not block create.
    }

    const [enriched] = await this.enrichWithBriefs(tenantId, [
      serializeProject(project),
    ]);
    return enriched;
  },

  async listForStudent(tenantId: string, studentId: string) {
    const projects = await projectRepository.list(tenantId, { studentId });
    await Promise.all(
      projects.map((p) => syncAndPersistApprovalProgress(tenantId, p)),
    );
    const withSupervisors = await this.enrichWithSupervisors(tenantId, projects);
    return this.enrichWithBriefs(tenantId, withSupervisors);
  },

  /**
   * Projects where this lecturer is supervisor or co-supervisor.
   * Includes nested student profile so the lecturer desk can show who connected.
   */
  async listForSupervisor(tenantId: string, supervisorId: string) {
    // Research desk only — assignment coursework lives under Assignments.
    const projects = await projectRepository.list(tenantId, {
      $or: [{ supervisorId }, { coSupervisorId: supervisorId }],
      projectType: { $ne: "assignment" },
    });
    await Promise.all(
      projects.map((p) => syncAndPersistApprovalProgress(tenantId, p)),
    );
    const withStudents = await this.enrichWithStudents(tenantId, projects);
    return this.enrichWithBriefs(tenantId, withStudents);
  },

  async listAssignmentsForSupervisor(tenantId: string, supervisorId: string) {
    const projects = await projectRepository.list(tenantId, {
      $or: [{ supervisorId }, { coSupervisorId: supervisorId }],
      projectType: "assignment",
    });
    await Promise.all(
      projects.map((p) => syncAndPersistApprovalProgress(tenantId, p)),
    );
    const withStudents = await this.enrichWithStudents(tenantId, projects);
    return this.enrichWithBriefs(tenantId, withStudents);
  },

  async get(tenantId: string, id: string) {
    const project = await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    await syncAndPersistApprovalProgress(tenantId, project);
    const [enriched] = await this.enrichWithBriefs(tenantId, [
      serializeProject(project),
    ]);
    return enriched;
  },

  /** Supervisor/co-supervisor may only open projects assigned to them. */
  async getForSupervisor(
    tenantId: string,
    id: string,
    supervisorId: string,
  ) {
    const project = await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only view projects assigned to you as supervisor",
      );
    }
    await syncAndPersistApprovalProgress(tenantId, project);
    const [enriched] = await this.enrichWithStudents(tenantId, [project]);
    const [withBrief] = await this.enrichWithBriefs(tenantId, [enriched]);
    return withBrief;
  },

  async getOwned(tenantId: string, id: string, studentId: string) {
    const project = await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    if (String(project.studentId) !== studentId) {
      throw new ForbiddenError("You can only access your own projects");
    }
    return project;
  },

  async enrichWithBriefs(
    tenantId: string,
    projects: unknown[],
  ): Promise<Array<Record<string, unknown> & { assignmentBrief: Record<string, unknown> | null }>> {
    const records = projects.map((p) => serializeProject(p));
    const briefIds = [
      ...new Set(
        records
          .map((p) =>
            p.assignmentBriefId ? String(p.assignmentBriefId) : "",
          )
          .filter(Boolean),
      ),
    ];
    if (briefIds.length === 0) {
      return records.map((p) => ({ ...p, assignmentBrief: null }));
    }
    const briefs = await Promise.all(
      briefIds.map((id) => assignmentBriefRepository.findById(tenantId, id)),
    );
    const byId = new Map(
      briefs
        .filter(Boolean)
        .map((b) => [String(b!._id), serializeBrief(b!)]),
    );
    return records.map((p) => ({
      ...p,
      assignmentBrief: p.assignmentBriefId
        ? byId.get(String(p.assignmentBriefId)) || null
        : null,
    }));
  },

  async enrichWithSupervisors(
    tenantId: string,
    projects: unknown[],
  ) {
    const supervisorIds = [
      ...new Set(
        projects
          .map((raw) => {
            const p = raw as { supervisorId?: unknown };
            return p.supervisorId ? String(p.supervisorId) : "";
          })
          .filter(Boolean),
      ),
    ];
    const supervisors = await userRepository.findByIds(tenantId, supervisorIds);
    const byId = new Map(
      supervisors.map((s) => [
        String(s._id),
        { id: String(s._id), name: s.name, email: s.email },
      ]),
    );
    return projects.map((raw) => {
      const p = raw as { supervisorId?: unknown };
      const serialized = serializeProject(raw);
      const supervisor = byId.get(String(p.supervisorId)) || null;
      return { ...serialized, supervisor };
    });
  },

  async enrichWithStudents(
    tenantId: string,
    projects: unknown[],
  ) {
    const studentIds = [
      ...new Set(
        projects
          .map((raw) => {
            const p = raw as { studentId?: unknown };
            return p.studentId ? String(p.studentId) : "";
          })
          .filter(Boolean),
      ),
    ];
    const students = await userRepository.findByIds(tenantId, studentIds);
    const byId = new Map(
      students.map((s) => [
        String(s._id),
        { id: String(s._id), name: s.name, email: s.email },
      ]),
    );
    return projects.map((raw) => {
      const p = raw as { studentId?: unknown };
      const serialized = serializeProject(raw);
      const student = byId.get(String(p.studentId)) || null;
      return { ...serialized, student };
    });
  },

  /** Soft-deletes a project owned by the student. */
  async deleteOwned(tenantId: string, id: string, studentId: string) {
    await this.getOwned(tenantId, id, studentId);
    const deleted = await projectRepository.softDelete(tenantId, id);
    if (!deleted) throw new NotFoundError("Project not found");
    return { id: String(deleted._id), deleted: true };
  },

  /** Adds a writing page with a title. */
  async addPage(
    tenantId: string,
    id: string,
    studentId: string,
    input: AddPageInput,
  ) {
    const project = await this.getOwned(tenantId, id, studentId);

    // Older projects may not have pages yet
    if (!Array.isArray(project.pages)) {
      project.set("pages", []);
    }

    const order = project.pages.length;
    project.pages.push({
      title: input.title.trim(),
      content: "",
      order,
    } as never);
    project.markModified("pages");
    const chapters = await chapterRepository.listByProject(tenantId, id);
    applyChapterApprovalProgress(project, chapters);
    await project.save();
    return serializeProject(project);
  },

  /** Updates a page title and/or content. */
  async updatePage(
    tenantId: string,
    id: string,
    pageId: string,
    studentId: string,
    input: UpdatePageInput,
  ) {
    const project = await this.getOwned(tenantId, id, studentId);

    if (!Array.isArray(project.pages)) {
      project.set("pages", []);
    }

    const page = project.pages.id(pageId);
    if (!page) throw new NotFoundError("Page not found");

    if (input.title !== undefined) page.title = input.title.trim();
    if (input.content !== undefined) page.content = input.content;

    project.markModified("pages");
    const chapters = await chapterRepository.listByProject(tenantId, id);
    applyChapterApprovalProgress(project, chapters);
    await project.save();
    return serializeProject(project);
  },

  /** Removes a writing page. */
  async deletePage(
    tenantId: string,
    id: string,
    pageId: string,
    studentId: string,
  ) {
    const project = await this.getOwned(tenantId, id, studentId);

    if (!Array.isArray(project.pages)) {
      project.set("pages", []);
    }

    const page = project.pages.id(pageId);
    if (!page) throw new NotFoundError("Page not found");
    page.deleteOne();
    project.markModified("pages");
    const chapters = await chapterRepository.listByProject(tenantId, id);
    applyChapterApprovalProgress(project, chapters);
    await project.save();
    return serializeProject(project);
  },

  /** Load a single writing page for an assigned supervisor. */
  async getPageForSupervisor(
    tenantId: string,
    projectId: string,
    pageId: string,
    supervisorId: string,
  ) {
    const project = await projectRepository.findById(tenantId, projectId);
    if (!project) throw new NotFoundError("Project not found");
    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only view pages on projects assigned to you",
      );
    }

    const page = project.pages?.id(pageId);
    if (!page) throw new NotFoundError("Page not found");

    const [enriched] = await this.enrichWithStudents(tenantId, [project]);
    const [withBrief] = await this.enrichWithBriefs(tenantId, [enriched]);
    const pageObj =
      typeof page.toObject === "function" ? page.toObject() : { ...page };

    const brief = (withBrief as { assignmentBrief?: Record<string, unknown> | null })
      .assignmentBrief;
    const maxScore =
      typeof brief?.maxScore === "number" ? brief.maxScore : 100;

    return {
      project: {
        _id: String(project._id),
        title: project.title,
        projectType: project.projectType,
        topic: project.topic,
        studentId: String(project.studentId),
        student: (withBrief as { student?: unknown }).student ?? null,
        assignmentBriefId: project.assignmentBriefId
          ? String(project.assignmentBriefId)
          : null,
        assignmentBrief: brief ?? null,
        score:
          typeof project.score === "number" ? project.score : null,
        scoreNote: String(project.scoreNote || ""),
        scoredAt: project.scoredAt ?? null,
        scoredBy: project.scoredBy ? String(project.scoredBy) : null,
        scoreSource: String(
          (project as { scoreSource?: string }).scoreSource || "none",
        ),
        aiSuggestedScore:
          typeof (project as { aiSuggestedScore?: number }).aiSuggestedScore ===
          "number"
            ? (project as { aiSuggestedScore: number }).aiSuggestedScore
            : null,
        aiGeneratedPercent:
          typeof (project as { aiGeneratedPercent?: number })
            .aiGeneratedPercent === "number"
            ? (project as { aiGeneratedPercent: number }).aiGeneratedPercent
            : null,
        aiReviewSnapshot:
          (project as { aiReviewSnapshot?: unknown }).aiReviewSnapshot ?? null,
        aiReviewedAt:
          (project as { aiReviewedAt?: Date | null }).aiReviewedAt ?? null,
        criterionScores: Array.isArray(project.criterionScores)
          ? project.criterionScores
          : [],
        maxScore,
      },
      page: {
        ...pageObj,
        _id: String(page._id),
      },
      pages: [...(project.pages || [])]
        .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
        .map((p) => ({
          _id: String(p._id),
          title: p.title,
          order: p.order,
          reviewStatus: (p as { reviewStatus?: string }).reviewStatus || "none",
        })),
    };
  },

  /**
   * Lecturer attaches a published brief to a student assignment project.
   */
  async attachBrief(
    tenantId: string,
    projectId: string,
    supervisorId: string,
    assignmentBriefId: string,
  ) {
    const project = await projectRepository.findById(tenantId, projectId);
    if (!project) throw new NotFoundError("Project not found");

    if (!isSinglePageProjectType(String(project.projectType))) {
      throw new ValidationError(
        "Assignment briefs can only be attached to assignment projects",
      );
    }

    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only attach briefs to assignments assigned to you",
      );
    }

    const brief = await assignmentBriefRepository.findById(
      tenantId,
      assignmentBriefId,
    );
    if (!brief || brief.status !== "published") {
      throw new ValidationError(
        "Assignment brief was not found or is not published",
      );
    }
    if (String(brief.lecturerId) !== supervisorId) {
      throw new ForbiddenError("You can only attach your own assignment briefs");
    }

    project.set("assignmentBriefId", assignmentBriefId);
    if (!String(project.courseName || "").trim() && brief.courseName) {
      project.set("courseName", String(brief.courseName).trim());
    }
    if (!String(project.courseYear || "").trim() && brief.courseYear) {
      project.set("courseYear", String(brief.courseYear).trim());
    }
    await project.save();

    const [enriched] = await this.enrichWithStudents(tenantId, [project]);
    const [withBrief] = await this.enrichWithBriefs(tenantId, [enriched]);
    return withBrief;
  },

  /**
   * Lecturer/supervisor sets or updates the score on an assignment project.
   * Notifies the student when the score changes.
   */
  async scoreAssignment(
    tenantId: string,
    projectId: string,
    supervisorId: string,
    input: ScoreAssignmentInput,
  ) {
    const project = await projectRepository.findById(tenantId, projectId);
    if (!project) throw new NotFoundError("Project not found");

    if (!isSinglePageProjectType(String(project.projectType))) {
      throw new ValidationError(
        "Scoring is only available for assignment projects",
      );
    }

    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only score assignments assigned to you",
      );
    }

    let maxScore = 100;
    let rubric: Array<{ name: string; maxMarks: number }> = [];
    if (project.assignmentBriefId) {
      const brief = await assignmentBriefRepository.findById(
        tenantId,
        String(project.assignmentBriefId),
      );
      if (brief) {
        maxScore =
          typeof brief.maxScore === "number" && brief.maxScore > 0
            ? brief.maxScore
            : 100;
        rubric = Array.isArray(brief.rubric)
          ? brief.rubric.map((r: { name?: string; maxMarks?: number }) => ({
              name: String(r.name),
              maxMarks: Number(r.maxMarks) || 0,
            }))
          : [];
      }
    }

    let finalScore = input.score;
    let scoreSource: "manual" | "ai_approved" = "manual";

    if (input.acceptAiScore) {
      const suggested = (project as { aiSuggestedScore?: number | null })
        .aiSuggestedScore;
      if (typeof suggested !== "number") {
        throw new ValidationError(
          "Run AI summarise first to generate a suggested mark before approving it",
        );
      }
      finalScore = suggested;
      scoreSource = "ai_approved";
    }

    if (typeof finalScore !== "number") {
      throw new ValidationError("Enter a score or approve the AI suggested mark");
    }

    if (finalScore > maxScore) {
      throw new ValidationError(`Score must be at most ${maxScore}`);
    }

    let criterionScores: Array<{
      name: string;
      score: number;
      maxMarks: number;
    }> = [];

    if (input.criterionScores && input.criterionScores.length > 0) {
      if (rubric.length === 0) {
        throw new ValidationError(
          "This assignment has no rubric criteria to score",
        );
      }
      const byName = new Map(rubric.map((r) => [r.name, r]));
      criterionScores = input.criterionScores.map((c) => {
        const match = byName.get(c.name);
        if (!match) {
          throw new ValidationError(`Unknown rubric criterion: ${c.name}`);
        }
        if (c.score > match.maxMarks) {
          throw new ValidationError(
            `Score for “${c.name}” must be at most ${match.maxMarks}`,
          );
        }
        return {
          name: c.name,
          score: c.score,
          maxMarks: match.maxMarks,
        };
      });
      const criterionTotal = criterionScores.reduce((s, c) => s + c.score, 0);
      // Allow lecturer to enter total separately; if only criteria given, sync total
      if (
        Math.abs(criterionTotal - finalScore) > 0.01 &&
        input.criterionScores.length === rubric.length
      ) {
        // Prefer explicit total when provided; still store criteria
      }
    }

    const note = (input.scoreNote || "").trim();
    project.set("score", finalScore);
    project.set("scoreNote", note);
    project.set("scoredAt", new Date());
    project.set("scoredBy", supervisorId);
    project.set("scoreSource", scoreSource);
    if (criterionScores.length > 0) {
      project.set("criterionScores", criterionScores);
    }
    await project.save();

    try {
      await notificationService.create(tenantId, String(project.studentId), {
        type: "assignment.scored",
        title: `Assignment scored: ${finalScore}/${maxScore}`,
        body:
          note ||
          (scoreSource === "ai_approved"
            ? `Your lecturer approved the AI suggested mark for “${project.title}”: ${finalScore}/${maxScore}.`
            : `Your lecturer scored “${project.title}” ${finalScore}/${maxScore}.`),
        data: {
          projectId: String(project._id),
          score: finalScore,
          maxScore,
          scoreSource,
          aiGeneratedPercent:
            (project as { aiGeneratedPercent?: number | null })
              .aiGeneratedPercent ?? null,
        },
      });
    } catch {
      // Score is saved; notification must not block.
    }

    const [enriched] = await this.enrichWithStudents(tenantId, [project]);
    const [withBrief] = await this.enrichWithBriefs(tenantId, [enriched]);
    return withBrief;
  },

  /**
   * Supervisor approves a page or requests rewrite with a remark.
   * Notifies the student.
   */
  async reviewPage(
    tenantId: string,
    projectId: string,
    pageId: string,
    supervisorId: string,
    input: ReviewPageInput,
  ) {
    const project = await projectRepository.findById(tenantId, projectId);
    if (!project) throw new NotFoundError("Project not found");
    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only review pages on projects assigned to you",
      );
    }

    if (!Array.isArray(project.pages)) {
      throw new NotFoundError("Page not found");
    }

    const page = project.pages.id(pageId);
    if (!page) throw new NotFoundError("Page not found");

    const remark = (input.remark || "").trim();
    const remarkText = stripRemarkHtml(remark);
    if (input.action === "needs_revision" && remarkText.length < 3) {
      throw new ValidationError(
        "Add a remark (at least 3 characters) when requesting a rewrite",
      );
    }

    page.set("reviewStatus", input.action === "approve" ? "approved" : "needs_revision");
    page.set("reviewRemark", remark);
    if (typeof input.annotatedHtml === "string") {
      page.set("reviewAnnotatedHtml", input.annotatedHtml);
    }
    page.set("reviewedAt", new Date());
    page.set("reviewedBy", supervisorId);
    project.markModified("pages");
    await project.save();

    // Keep chapter workflow in sync with page decisions when titles match
    const pageTitleKey = normalizeProgressTitle(String(page.title || ""));
    const chapters = await chapterRepository.listByProject(tenantId, projectId);
    const matched = chapters.find(
      (c) => normalizeProgressTitle(String(c.title || "")) === pageTitleKey,
    );
    if (matched) {
      try {
        const { chapterService } = await import("./portal-chapter.service.js");
        if (input.action === "approve") {
          if (
            matched.status === "submitted" ||
            matched.status === "under_review"
          ) {
            await chapterService.approve(
              tenantId,
              String(matched._id),
              supervisorId,
            );
          } else if (
            matched.status !== "approved" &&
            matched.status !== "locked"
          ) {
            matched.status = "locked" as never;
            matched.locked = true;
            matched.approvedAt = new Date();
            matched.rejectionReason = undefined;
            await matched.save();
          }
        } else if (
          matched.status === "submitted" ||
          matched.status === "under_review"
        ) {
          await chapterService.reject(
            tenantId,
            String(matched._id),
            remark,
            true,
          );
        }
      } catch {
        // Page review already saved; chapter sync must not block.
      }
    }

    await this.calculateProgress(tenantId, projectId);

    try {
      await notificationService.create(
        tenantId,
        String(project.studentId),
        {
          type:
            input.action === "approve"
              ? "page.approved"
              : "page.needs_revision",
          title:
            input.action === "approve"
              ? `Page approved: ${page.title}`
              : `Rewrite requested: ${page.title}`,
          body:
            input.action === "approve"
              ? remarkText ||
                `Your supervisor approved “${page.title}”.`
              : remarkText,
          data: {
            projectId: String(project._id),
            pageId: String(page._id),
            action: input.action,
          },
        },
      );
    } catch {
      // Review is saved; notification must not block.
    }

    return this.getPageForSupervisor(
      tenantId,
      projectId,
      pageId,
      supervisorId,
    );
  },

  /**
   * Bulk-import analysed sections as project pages (from Word upload).
   * mode=replace clears existing pages; append keeps them.
   * Assignment projects always collapse to a single writing page.
   */
  async importPages(
    tenantId: string,
    id: string,
    studentId: string,
    input: ImportPagesInput,
  ) {
    const project = await this.getOwned(tenantId, id, studentId);
    const singlePage = isSinglePageProjectType(String(project.projectType));

    if (!Array.isArray(project.pages) || input.mode === "replace" || singlePage) {
      project.set("pages", []);
    }

    // Collapse duplicate titles from TOC + body before writing pages
    const { dedupeSectionsByTitle, dropEmptyTocStubs } = await import(
      "../../lib/portal-docs/split-sections.js"
    );
    let sections = dropEmptyTocStubs(
      dedupeSectionsByTitle(
        input.sections.map((s) => ({
          title: s.title.trim().slice(0, 200),
          content: s.content.slice(0, 500_000),
        })),
      ),
    );

    // Assignments: one page with the full imported body (join if callers split)
    if (singlePage && sections.length > 0) {
      const first = sections[0];
      if (sections.length === 1) {
        sections = [first];
      } else {
        const hasHtml = sections.some((s) => /<[a-z][\s\S]*>/i.test(s.content));
        const joined = sections
          .map((s) => {
            const body = s.content.trim();
            if (!body) return "";
            if (hasHtml) {
              return `<h2>${s.title
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")}</h2>${body}`;
            }
            return `${s.title}\n\n${body}`;
          })
          .filter(Boolean)
          .join(hasHtml ? "" : "\n\n");
        sections = [
          {
            title: first.title || "Assignment",
            content: joined.slice(0, 500_000),
          },
        ];
      }
    }

    for (const section of sections) {
      const key = section.title.toLowerCase();
      const existing = project.pages.find(
        (p: { title?: string; content?: string }) =>
          String(p.title || "").trim().toLowerCase() === key,
      );
      if (existing) {
        // Prefer richer content when appending a section that already exists
        if (
          section.content.trim().length > String(existing.content || "").trim().length
        ) {
          existing.content = section.content;
        }
        continue;
      }
      project.pages.push({
        title: section.title,
        content: section.content,
        order: project.pages.length,
      } as never);
    }

    project.markModified("pages");
    const chapters = await chapterRepository.listByProject(tenantId, id);
    applyChapterApprovalProgress(project, chapters);
    await project.save();
    return serializeProject(project);
  },

  /** Saves textarea tab content for the project's type. */
  async saveSections(
    tenantId: string,
    id: string,
    studentId: string,
    input: SaveSectionsInput,
  ) {
    const project = await this.getOwned(tenantId, id, studentId);
    const current =
      project.sections instanceof Map
        ? Object.fromEntries(project.sections.entries())
        : ((project.sections as Record<string, string>) ?? {});

    const next = { ...current, ...input.sections };
    project.set("sections", next);
    if (typeof next.abstract === "string") {
      project.abstract = next.abstract;
    }

    const chapters = await chapterRepository.listByProject(tenantId, id);
    applyChapterApprovalProgress(project, chapters);

    await project.save();
    return serializeProject(project);
  },

  async submitTopic(tenantId: string, id: string, studentId?: string) {
    const project = studentId
      ? await this.getOwned(tenantId, id, studentId)
      : await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    if (project.topicStatus !== "draft") {
      throw new ValidationError("Only draft topics can be submitted");
    }
    project.topicStatus = "submitted";
    await project.save();
    return serializeProject(project);
  },

  async approveTopic(tenantId: string, id: string) {
    const project = await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    if (project.topicStatus !== "submitted") {
      throw new ValidationError("Topic must be submitted before approval");
    }
    project.topicStatus = "approved";
    project.stage = ProjectStage.Proposal;
    await project.save();
    return serializeProject(project);
  },

  async assignSupervisor(
    tenantId: string,
    id: string,
    supervisorId: string,
    coSupervisorId?: string,
  ) {
    const project = await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    project.supervisorId = supervisorId as never;
    if (coSupervisorId) project.coSupervisorId = coSupervisorId as never;
    await project.save();
    return serializeProject(project);
  },

  async calculateProgress(tenantId: string, id: string) {
    const project = await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    const chapters = await chapterRepository.listByProject(tenantId, id);
    applyChapterApprovalProgress(project, chapters);
    await project.save();
    return project.progressPercent;
  },

  async getTimeline(tenantId: string, id: string, studentId?: string) {
    const project = studentId
      ? await this.getOwned(tenantId, id, studentId)
      : await projectRepository.findById(tenantId, id);
    if (!project) throw new NotFoundError("Project not found");
    return {
      projectId: String(project._id),
      milestones: project.timeline?.milestones || [],
    };
  },

  async setTimeline(
    tenantId: string,
    id: string,
    studentId: string,
    milestones: Array<{
      title: string;
      dueDate: string;
      status?: string;
      notes?: string;
    }>,
  ) {
    const project = await this.getOwned(tenantId, id, studentId);
    project.set("timeline", { milestones });
    await project.save();
    return serializeProject(project);
  },

  async listDeadlinesForStudent(tenantId: string, studentId: string) {
    const projects = await projectRepository.list(tenantId, { studentId });
    const items: Array<{
      projectId: string;
      projectTitle: string;
      title: string;
      dueDate: string;
      status?: string;
      notes?: string;
    }> = [];

    for (const project of projects) {
      const milestones = (project.timeline?.milestones || []) as Array<{
        title?: string;
        dueDate?: string;
        status?: string;
        notes?: string;
      }>;
      for (const m of milestones) {
        if (!m?.title || !m?.dueDate) continue;
        items.push({
          projectId: String(project._id),
          projectTitle: project.title,
          title: m.title,
          dueDate: m.dueDate,
          status: m.status,
          notes: m.notes,
        });
      }
    }

    items.sort(
      (a, b) => new Date(a.dueDate).getTime() - new Date(b.dueDate).getTime(),
    );
    return items;
  },

  async exportPackage(tenantId: string, id: string, studentId: string) {
    const project = await this.getOwned(tenantId, id, studentId);
    const pages = [...(project.pages || [])].sort(
      (a, b) => (a.order ?? 0) - (b.order ?? 0),
    );
    const chapters = await chapterRepository.listByProject(tenantId, id);

    const escape = (s: string) =>
      s
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    const pageHtml = pages
      .map(
        (p) =>
          `<section><h2>${escape(p.title)}</h2>${p.content || "<p></p>"}</section>`,
      )
      .join("\n");

    const chapterMeta = chapters
      .map(
        (c) =>
          `<li>${escape(c.title)} — ${escape(String(c.status))}</li>`,
      )
      .join("");

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escape(project.title)}</title>
<style>
  body{font-family:Georgia,serif;max-width:800px;margin:2rem auto;padding:0 1rem;line-height:1.6;color:#111}
  h1{font-size:1.8rem} h2{margin-top:2rem;border-bottom:1px solid #ddd;padding-bottom:.3rem}
  .meta{color:#555;font-size:.9rem}
</style>
</head>
<body>
  <h1>${escape(project.title)}</h1>
  <p class="meta">Type: ${escape(String(project.projectType))} · Topic status: ${escape(String(project.topicStatus || "draft"))} · Exported ${new Date().toISOString()}</p>
  ${project.abstract ? `<section><h2>Abstract</h2><p>${escape(project.abstract)}</p></section>` : ""}
  ${chapterMeta ? `<section><h2>Chapter status</h2><ul>${chapterMeta}</ul></section>` : ""}
  ${pageHtml || "<p><em>No pages exported.</em></p>"}
</body>
</html>`;

    const safeName = String(project.title)
      .replace(/[^\w\-]+/g, "_")
      .slice(0, 60);
    return { html, filename: `${safeName || "thesis"}_package.html` };
  },
};
