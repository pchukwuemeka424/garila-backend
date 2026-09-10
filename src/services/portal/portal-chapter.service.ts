import { PortalChapterModel as Chapter } from "../../db/models/PortalChapter.js";
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../lib/portal-errors.js";
import { ChapterStatus } from "../../lib/portal-enums.js";
import { chapterRepository } from "./portal-chapter.repo.js";
import { projectRepository } from "./portal-project.repo.js";
import { projectService } from "./portal-project.service.js";
import { aiReviewService } from "./portal-ai.service.js";
import { notificationService } from "./portal-notification.service.js";
import type {
  AddChapterInput,
  SaveChapterDraftInput,
} from "./portal-dto.js";
import {
  backfillPageReviewTrail,
  countWordsFromHtml,
  pushPageReviewTrail,
  serializeReviewTrail,
} from "../../lib/portal-review/review-trail.js";

const SUBMITTABLE: ChapterStatus[] = [
  ChapterStatus.Draft,
  ChapterStatus.NeedsRevision,
  ChapterStatus.Rejected,
];

const REVIEWABLE: ChapterStatus[] = [
  ChapterStatus.Submitted,
  ChapterStatus.UnderReview,
];

function normalizeTitleKey(title: string) {
  return String(title || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Match a chapter to its writing page by exact title, then soft variants
 * (e.g. "Chapter One: Introduction" ↔ "Introduction").
 */
function findMatchingProjectPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pages: any[],
  chapter: { title?: string; number?: number },
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
): any | undefined {
  const key = normalizeTitleKey(chapter.title || "");
  if (!key) return undefined;

  const exact = pages.find(
    (p) => normalizeTitleKey(String(p.title || "")) === key,
  );
  if (exact) return exact;

  // "Chapter 1: Title" / "CHAPTER ONE — Title" → compare trailing title
  const stripChapterPrefix = (t: string) =>
    normalizeTitleKey(t).replace(
      /^chapter\s+(?:\d+|[ivxlcdm]+|one|two|three|four|five|six|seven|eight|nine|ten)\s*[:.\-–—]?\s*/i,
      "",
    );

  const chapterTail = stripChapterPrefix(chapter.title || "");
  if (chapterTail && chapterTail !== key) {
    const byTail = pages.find((p) => {
      const pt = normalizeTitleKey(String(p.title || ""));
      const pageTail = stripChapterPrefix(String(p.title || ""));
      return (
        pt === chapterTail ||
        pageTail === chapterTail ||
        pt === key ||
        pageTail === key
      );
    });
    if (byTail) return byTail;
  }

  // Fall back to page order ≈ chapter number (1-based)
  if (typeof chapter.number === "number" && chapter.number >= 1) {
    const byOrder = pages.find(
      (p) => Number(p.order) === chapter.number! - 1,
    );
    if (byOrder) return byOrder;
  }

  return undefined;
}

export const chapterService = {
  /** Adds a chapter using the student's title (page title). */
  async addChapter(
    tenantId: string,
    projectId: string,
    studentId: string,
    input: AddChapterInput,
  ) {
    const project = await projectRepository.findById(tenantId, projectId);
    if (!project) throw new NotFoundError("Project not found");
    if (String(project.studentId) !== studentId) {
      throw new ForbiddenError("You can only add chapters to your own projects");
    }

    const existing = await chapterRepository.findByNumber(
      tenantId,
      projectId,
      input.number,
    );
    if (existing) {
      throw new ConflictError("This chapter has already been added");
    }

    const title = input.title?.trim();
    if (!title) {
      throw new ValidationError(
        "Provide a chapter title (use your page title)",
      );
    }

    const chapter = await chapterRepository.create({
      tenantId,
      projectId,
      number: input.number,
      title,
      content: "",
      status: ChapterStatus.Draft,
      locked: false,
      unlockedAt: new Date(),
    });

    return chapter;
  },

  async listForProject(tenantId: string, projectId: string) {
    return chapterRepository.listByProject(tenantId, projectId);
  },

  /** Saves textarea draft content for a chapter. */
  async saveDraft(
    tenantId: string,
    chapterId: string,
    studentId: string,
    input: SaveChapterDraftInput,
  ) {
    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");

    const project = await projectRepository.findById(
      tenantId,
      String(chapter.projectId),
    );
    if (!project || String(project.studentId) !== studentId) {
      throw new ForbiddenError("You can only edit your own chapters");
    }

    // Allow drafting even when sequentially locked — submit path clears the lock.
    chapter.content = input.content;
    if (
      chapter.status === ChapterStatus.NeedsRevision ||
      chapter.status === ChapterStatus.Rejected
    ) {
      chapter.status = ChapterStatus.Draft;
    }
    await chapter.save();
    return chapter;
  },
  /**
   * Submits a draft/revision, creates an immutable version,
   * queues AI review, and moves the chapter to Submitted.
   */
  async submit(
    tenantId: string,
    chapterId: string,
    userId: string,
    content: Record<string, unknown>,
  ) {
    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");

    if (!SUBMITTABLE.includes(chapter.status as ChapterStatus)) {
      throw new ValidationError(
        `Chapter status '${chapter.status}' does not allow submission`,
      );
    }

    // Clear sequential lock so students can submit without waiting on prior approval.
    if (chapter.locked) {
      chapter.locked = false;
      chapter.unlockedAt = new Date();
    }

    const last = await chapterRepository.lastVersion(tenantId, chapterId);
    const version = await chapterRepository.createVersion({
      tenantId,
      chapterId,
      projectId: chapter.projectId,
      versionNumber: (last?.versionNumber ?? 0) + 1,
      submittedBy: userId,
      submittedAt: new Date(),
      ...content,
    });

    chapter.status = ChapterStatus.Submitted;
    chapter.currentVersionId = version._id;
    chapter.reviewAnnotatedHtml = "";
    chapter.markModified("reviewAnnotatedHtml");
    await chapter.save();

    const review = await aiReviewService.enqueue(
      tenantId,
      String(version._id),
    );

    chapter.status = ChapterStatus.UnderReview;
    await chapter.save();

    try {
      const project = await projectRepository.findById(
        tenantId,
        String(chapter.projectId),
      );
      if (project && Array.isArray(project.pages)) {
        const page = findMatchingProjectPage(project.pages, chapter);
        if (page) {
          const rich = content.richTextJson as
            | { html?: string }
            | undefined;
          const html = String(
            rich?.html || chapter.content || page.content || "",
          );
          const wordCount =
            typeof content.wordCount === "number"
              ? content.wordCount
              : countWordsFromHtml(html);
          pushPageReviewTrail(page, {
            type: "submitted",
            at: version.submittedAt instanceof Date
              ? version.submittedAt
              : new Date(),
            actorId: userId,
            contentHtml: html,
            versionNumber: version.versionNumber,
            wordCount,
          });
          page.set("reviewStatus", "none");
          page.set("reviewAnnotatedHtml", "");
          project.markModified("pages");
          await project.save();
        }
      }
    } catch {
      // Version is already stored; page trail must not block submit.
    }

    try {
      await notificationService.notifyProjectStakeholders(
        tenantId,
        String(chapter.projectId),
        {
          type: "chapter.submitted",
          title: `“${chapter.title}” submitted`,
          body: `“${chapter.title}” was submitted and queued for AI review.`,
          data: {
            projectId: String(chapter.projectId),
            chapterId,
            versionId: String(version._id),
            reviewId: String(review._id),
          },
        },
      );
    } catch {
      // Notifications must not fail submit.
    }

    return { chapter, version, review };
  },

  /**
   * Approves a chapter under review, locks it, unlocks the next chapter,
   * and recalculates project progress.
   */
  async approve(
    tenantId: string,
    chapterId: string,
    actorId: string,
    options?: { skipPageTrail?: boolean },
  ) {
    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");

    if (!REVIEWABLE.includes(chapter.status as ChapterStatus)) {
      throw new ValidationError("Only chapters under review can be approved");
    }

    chapter.status = ChapterStatus.Approved;
    chapter.locked = true;
    chapter.approvedAt = new Date();
    await chapter.save();

    // Transition approved → locked for archival integrity of the gate
    chapter.status = ChapterStatus.Locked;
    await chapter.save();

    const next = await Chapter.findOne({
      universityId: tenantId,
      projectId: chapter.projectId,
      number: chapter.number + 1,
      deletedAt: { $exists: false },
    });

    if (next) {
      next.locked = false;
      next.status = ChapterStatus.Draft;
      next.unlockedAt = new Date();
      await next.save();
    }

    // Mirror approval onto the matching writing page
    try {
      const project = await projectRepository.findById(
        tenantId,
        String(chapter.projectId),
      );
      if (project && Array.isArray(project.pages)) {
        const key = String(chapter.title || "")
          .trim()
          .toLowerCase()
          .replace(/\s+/g, " ");
        const page = project.pages.find(
          (p: { title?: string }) =>
            String(p.title || "")
              .trim()
              .toLowerCase()
              .replace(/\s+/g, " ") === key,
        );
        if (page) {
          page.set("reviewStatus", "approved");
          page.set("reviewedAt", new Date());
          page.set("reviewedBy", actorId);
          if (!page.reviewRemark) page.set("reviewRemark", "");
          if (!options?.skipPageTrail) {
            pushPageReviewTrail(page, {
              type: "approved",
              at: new Date(),
              actorId,
              remark: String(page.reviewRemark || ""),
              contentHtml: String(page.content || ""),
              annotatedHtml: String(page.reviewAnnotatedHtml || ""),
              wordCount: countWordsFromHtml(
                String(page.content || page.reviewAnnotatedHtml || ""),
              ),
            });
          }
          project.markModified("pages");
          await project.save();
        }
      }
    } catch {
      // Progress still updates even if page mirror fails.
    }

    await projectService.calculateProgress(tenantId, String(chapter.projectId));

    try {
      await notificationService.notifyProjectStakeholders(
        tenantId,
        String(chapter.projectId),
        {
          type: "chapter.approved",
          title: `“${chapter.title}” approved`,
          body: `“${chapter.title}” was approved and locked.`,
          data: {
            projectId: String(chapter.projectId),
            chapterId,
            actorId,
          },
        },
      );
    } catch {
      // Notifications must not fail the approval transaction path.
    }

    return chapter;
  },

  /**
   * Rejects or requests revision on a chapter under review.
   */
  async reject(
    tenantId: string,
    chapterId: string,
    reason: string,
    needsRevision = true,
    annotatedHtml?: string,
    options?: { skipPageTrail?: boolean; actorId?: string },
  ) {
    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");

    if (!REVIEWABLE.includes(chapter.status as ChapterStatus)) {
      throw new ValidationError("Only chapters under review can be rejected");
    }

    chapter.status = needsRevision
      ? ChapterStatus.NeedsRevision
      : ChapterStatus.Rejected;
    chapter.locked = false;
    chapter.rejectionReason = reason;
    chapter.reviewDraftRemark = reason;
    if (typeof annotatedHtml === "string" && annotatedHtml.trim()) {
      chapter.reviewAnnotatedHtml = annotatedHtml;
      chapter.markModified("reviewAnnotatedHtml");
    }
    chapter.markModified("reviewDraftRemark");
    await chapter.save();

    try {
      const project = await projectRepository.findById(
        tenantId,
        String(chapter.projectId),
      );
      if (project && Array.isArray(project.pages)) {
        const page = findMatchingProjectPage(project.pages, chapter);
        if (page) {
          page.set("reviewStatus", "needs_revision");
          page.set("reviewRemark", reason.slice(0, 50_000));
          const annotated =
            typeof annotatedHtml === "string" && annotatedHtml.trim()
              ? annotatedHtml
              : String(chapter.reviewAnnotatedHtml || "");
          if (annotated) page.set("reviewAnnotatedHtml", annotated);
          page.set("reviewedAt", new Date());
          if (options?.actorId) page.set("reviewedBy", options.actorId);
          if (!options?.skipPageTrail) {
            pushPageReviewTrail(page, {
              type: "rewrite_requested",
              at: new Date(),
              actorId: options?.actorId,
              remark: reason,
              contentHtml: String(page.content || ""),
              annotatedHtml: annotated,
              wordCount: countWordsFromHtml(
                String(page.content || annotated || ""),
              ),
            });
          }
          project.markModified("pages");
          await project.save();
        }
      }
    } catch {
      // Progress still updates even if page mirror fails.
    }

    await projectService.calculateProgress(tenantId, String(chapter.projectId));

    try {
      await notificationService.notifyProjectStakeholders(
        tenantId,
        String(chapter.projectId),
        {
          type: "chapter.needs_revision",
          title: `“${chapter.title}” needs revision`,
          body: String(reason || "")
            .replace(/<[^>]+>/g, " ")
            .replace(/\s+/g, " ")
            .trim(),
          data: {
            projectId: String(chapter.projectId),
            chapterId,
          },
        },
      );
    } catch {
      // Notifications must not fail reject.
    }

    return chapter;
  },

  /**
   * Auto-saves supervisor review draft: remark, highlighted HTML, AI Reviewer report.
   */
  async saveSupervisorReview(
    tenantId: string,
    chapterId: string,
    supervisorId: string,
    input: {
      remark?: string;
      annotatedHtml?: string;
      aiReviewerReport?: Record<string, unknown> | null;
    },
  ) {
    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");

    const project = await projectRepository.findById(
      tenantId,
      String(chapter.projectId),
    );
    if (!project) throw new NotFoundError("Project not found");

    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError(
        "You can only save reviews on projects assigned to you",
      );
    }

    if (typeof input.remark === "string") {
      chapter.reviewDraftRemark = input.remark.slice(0, 5000);
      chapter.markModified("reviewDraftRemark");
    }
    if (typeof input.annotatedHtml === "string") {
      chapter.reviewAnnotatedHtml = input.annotatedHtml;
      chapter.markModified("reviewAnnotatedHtml");
    }
    if (input.aiReviewerReport !== undefined) {
      chapter.set("aiReviewerReport", input.aiReviewerReport);
      chapter.aiReviewerAt = input.aiReviewerReport ? new Date() : undefined;
      chapter.markModified("aiReviewerReport");
      chapter.markModified("aiReviewerAt");
    }
    await chapter.save();

    // Mirror annotated HTML + draft remark onto the matching writing page
    // so students see highlights after Request revision (and in Feedback).
    try {
      if (Array.isArray(project.pages)) {
        const page = findMatchingProjectPage(project.pages, chapter);
        if (page) {
          if (typeof input.remark === "string") {
            page.set("reviewRemark", input.remark.slice(0, 50_000));
          }
          if (typeof input.annotatedHtml === "string") {
            page.set("reviewAnnotatedHtml", input.annotatedHtml);
          }
          project.markModified("pages");
          await project.save();
        }
      }
    } catch {
      // Chapter save is the source of truth; page mirror is best-effort.
    }

    return {
      _id: String(chapter._id),
      reviewDraftRemark: chapter.reviewDraftRemark || "",
      reviewAnnotatedHtml: chapter.reviewAnnotatedHtml || "",
      aiReviewerReport: chapter.aiReviewerReport || null,
      aiReviewerAt: chapter.aiReviewerAt || null,
      updatedAt: chapter.updatedAt,
    };
  },

  async listVersions(tenantId: string, chapterId: string) {
    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");
    return chapterRepository.listVersions(tenantId, chapterId);
  },

  /**
   * Full review payload for a supervisor: chapter, version HTML, AI report, student.
   */
  async getForSupervisorReview(
    tenantId: string,
    chapterId: string,
    supervisorId: string,
  ) {
    const chapter = await chapterRepository.findById(tenantId, chapterId);
    if (!chapter) throw new NotFoundError("Chapter not found");

    const project = await projectRepository.findById(
      tenantId,
      String(chapter.projectId),
    );
    if (!project) throw new NotFoundError("Project not found");

    const isAssigned =
      String(project.supervisorId || "") === supervisorId ||
      String(project.coSupervisorId || "") === supervisorId;
    if (!isAssigned) {
      throw new ForbiddenError("You are not assigned to this project");
    }

    let version = null as Awaited<
      ReturnType<typeof chapterRepository.findVersion>
    > | null;
    if (chapter.currentVersionId) {
      version = await chapterRepository.findVersion(
        tenantId,
        String(chapter.currentVersionId),
      );
    }
    if (!version) {
      version = await chapterRepository.lastVersion(tenantId, chapterId);
    }

    let review = null as Awaited<
      ReturnType<typeof aiReviewService.getByVersion>
    > | null;
    if (version) {
      try {
        review = await aiReviewService.getByVersion(
          tenantId,
          String(version._id),
        );
      } catch {
        review = null;
      }
    }

    const { userRepository } = await import("./portal-users.js");
    const studentDoc = await userRepository.findById(
      tenantId,
      String(project.studentId),
    );

    const rich = version?.richTextJson as
      | { html?: string; title?: string }
      | undefined;
    const html =
      (rich?.html && String(rich.html)) ||
      String(chapter.content || "") ||
      "";

    const matchedPage = Array.isArray(project.pages)
      ? findMatchingProjectPage(project.pages, chapter)
      : undefined;
    if (matchedPage && backfillPageReviewTrail(matchedPage)) {
      project.markModified("pages");
      await project.save();
    }

    return {
      chapter: {
        _id: String(chapter._id),
        number: chapter.number,
        title: chapter.title,
        status: chapter.status,
        locked: chapter.locked,
        rejectionReason: chapter.rejectionReason,
        reviewDraftRemark: chapter.reviewDraftRemark || "",
        reviewAnnotatedHtml: chapter.reviewAnnotatedHtml || "",
        aiReviewerReport: chapter.aiReviewerReport || null,
        aiReviewerAt: chapter.aiReviewerAt || null,
        approvedAt: chapter.approvedAt,
        updatedAt: chapter.updatedAt,
        currentVersionId: chapter.currentVersionId
          ? String(chapter.currentVersionId)
          : undefined,
      },
      version: version
        ? {
            _id: String(version._id),
            versionNumber: version.versionNumber,
            wordCount: version.wordCount,
            submittedAt: version.submittedAt,
            contentType: version.contentType,
          }
        : null,
      html,
      annotatedHtml: chapter.reviewAnnotatedHtml || "",
      review: review
        ? {
            _id: String(review._id),
            status: review.status,
            model: review.model,
            report: review.report,
            completedAt: review.completedAt,
            error: review.error,
          }
        : null,
      aiReviewer: chapter.aiReviewerReport
        ? {
            report: chapter.aiReviewerReport,
            savedAt: chapter.aiReviewerAt || null,
          }
        : null,
      project: {
        _id: String(project._id),
        title: project.title,
        topic: project.topic,
        projectType: project.projectType,
        studentId: String(project.studentId),
      },
      student: studentDoc
        ? {
            id: String(studentDoc._id),
            name: studentDoc.name,
            email: studentDoc.email,
          }
        : null,
      reviewTrail: matchedPage ? serializeReviewTrail(matchedPage) : [],
    };
  },

  /**
   * Chapters awaiting this lecturer’s review across assigned projects.
   */
  async listPendingForSupervisor(tenantId: string, supervisorId: string) {
    // Chapter review queue is for research supervisees, not assignment briefs.
    const projects = await projectRepository.list(tenantId, {
      $or: [{ supervisorId }, { coSupervisorId: supervisorId }],
      projectType: { $ne: "assignment" },
    });
    if (projects.length === 0) return [];

    const projectById = new Map(
      projects.map((p) => [String(p._id), p] as const),
    );
    const chapters = await chapterRepository.listPendingByProjectIds(
      tenantId,
      [...projectById.keys()],
      REVIEWABLE,
    );

    const studentIds = [
      ...new Set(projects.map((p) => String(p.studentId)).filter(Boolean)),
    ];
    const { userRepository } = await import("./portal-users.js");
    const students = await userRepository.findByIds(tenantId, studentIds);
    const studentById = new Map(
      students.map((s) => [
        String(s._id),
        { id: String(s._id), name: s.name, email: s.email },
      ]),
    );

    return chapters.map((chapter) => {
      const project = projectById.get(String(chapter.projectId));
      const student = project
        ? studentById.get(String(project.studentId)) || null
        : null;
      return {
        _id: String(chapter._id),
        number: chapter.number,
        title: chapter.title,
        status: chapter.status,
        updatedAt: chapter.updatedAt,
        projectId: String(chapter.projectId),
        projectTitle: project?.title || "Project",
        student,
      };
    });
  },

  async getVersion(tenantId: string, versionId: string) {
    const version = await chapterRepository.findVersion(tenantId, versionId);
    if (!version) throw new NotFoundError("Version not found");
    return version;
  },

  /**
   * Syncs page HTML into a chapter draft, then submits for AI review.
   * Bridges the freeform page editor with the chapter workflow.
   */
  async submitFromPage(
    tenantId: string,
    projectId: string,
    studentId: string,
    input: {
      chapterNumber: number;
      title: string;
      html: string;
      wordCount?: number;
    },
  ) {
    const title = input.title.trim();
    if (!title) {
      throw new ValidationError("Provide a chapter title (use your page title)");
    }

    let chapter = await chapterRepository.findByNumber(
      tenantId,
      projectId,
      input.chapterNumber,
    );

    if (!chapter) {
      chapter = await this.addChapter(tenantId, projectId, studentId, {
        number: input.chapterNumber,
        title,
      });
    } else {
      // Keep review-queue title in sync with the student's writing page title.
      chapter.title = title;
      await chapter.save();
    }

    await this.saveDraft(tenantId, String(chapter._id), studentId, {
      content: input.html,
    });

    return this.submit(tenantId, String(chapter._id), studentId, {
      contentType: "richtext" as const,
      richTextJson: { html: input.html, title },
      wordCount: input.wordCount ?? 0,
    });
  },
};
