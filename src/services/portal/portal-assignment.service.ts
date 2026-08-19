import {
  ForbiddenError,
  NotFoundError,
  ValidationError,
} from "../../lib/portal-errors.js";
import { userRepository } from "./portal-users.js";
import { projectRepository } from "./portal-project.repo.js";
import { assignmentBriefRepository } from "./portal-assignment.repo.js";
import type {
  CreateAssignmentBriefInput,
  UpdateAssignmentBriefInput,
} from "./portal-dto.js";

type PageLike = {
  _id?: unknown;
  content?: string;
  order?: number;
  reviewStatus?: string;
  title?: string;
};

function primaryPage(pages: PageLike[] | undefined) {
  if (!Array.isArray(pages) || pages.length === 0) return null;
  return [...pages].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))[0] ?? null;
}

function submissionStatus(project: {
  score?: number | null;
  pages?: PageLike[];
}): "draft" | "submitted" {
  if (typeof project.score === "number") return "submitted";
  const pages = Array.isArray(project.pages) ? project.pages : [];
  for (const page of pages) {
    if (page.reviewStatus && page.reviewStatus !== "none") return "submitted";
    if (String(page.content || "").trim()) return "submitted";
  }
  return "draft";
}

function parseDueAt(value: string | null | undefined) {
  if (value == null || value === "") return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new ValidationError("Invalid due date");
  }
  return date;
}

function serializeBrief(brief: unknown) {
  const doc = brief as { toObject?: () => Record<string, unknown> };
  if (typeof doc.toObject === "function") {
    return doc.toObject();
  }
  return { ...(brief as Record<string, unknown>) };
}

function normalizePayload(input: CreateAssignmentBriefInput | UpdateAssignmentBriefInput) {
  const payload: Record<string, unknown> = { ...input };
  if ("dueAt" in input) {
    payload.dueAt = parseDueAt(
      input.dueAt === null || input.dueAt === undefined
        ? null
        : String(input.dueAt),
    );
  }
  if ("requiredItems" in input && Array.isArray(input.requiredItems)) {
    payload.requiredItems = input.requiredItems
      .map((item) => item.trim())
      .filter(Boolean);
  }
  if ("wordCountMin" in input && input.wordCountMin === undefined) {
    delete payload.wordCountMin;
  }
  if ("wordCountMax" in input && input.wordCountMax === undefined) {
    delete payload.wordCountMax;
  }
  return payload;
}

export const assignmentBriefService = {
  async create(
    tenantId: string,
    lecturerId: string,
    input: CreateAssignmentBriefInput,
  ) {
    const brief = await assignmentBriefRepository.create({
      tenantId,
      lecturerId,
      ...normalizePayload(input),
    });
    return serializeBrief(brief);
  },

  async listForLecturer(tenantId: string, lecturerId: string) {
    const briefs = await assignmentBriefRepository.listForLecturer(
      tenantId,
      lecturerId,
    );
    const serialized = briefs.map(serializeBrief);
    const counts = await projectRepository.countByAssignmentBriefIds(
      tenantId,
      serialized.map((b) => String((b as { _id?: unknown })._id)),
    );
    return serialized.map((brief) => ({
      ...brief,
      submissionCount: counts.get(String((brief as { _id?: unknown })._id)) ?? 0,
    }));
  },

  /**
   * Student assignment projects linked to a brief the lecturer owns.
   * Includes student profile, mat no, course/year, status, score, and review href.
   */
  async listSubmissions(tenantId: string, briefId: string, lecturerId: string) {
    const brief = await this.getForLecturer(tenantId, briefId, lecturerId);
    const maxScore =
      typeof brief.maxScore === "number" ? brief.maxScore : 100;

    const projects = await projectRepository.listByAssignmentBrief(
      tenantId,
      briefId,
    );
    const studentIds = [
      ...new Set(projects.map((p) => String(p.studentId)).filter(Boolean)),
    ];
    const students = await userRepository.findByIds(tenantId, studentIds);
    const studentById = new Map(
      students.map((s) => [
        String(s._id),
        { id: String(s._id), name: s.name, email: s.email },
      ]),
    );

    return projects.map((project) => {
      const pages = (Array.isArray(project.pages) ? project.pages : []) as PageLike[];
      const page = primaryPage(pages);
      const pageId = page?._id ? String(page._id) : null;
      const projectId = String(project._id);
      const status = submissionStatus({
        score: typeof project.score === "number" ? project.score : null,
        pages,
      });
      const student =
        studentById.get(String(project.studentId)) || null;

      return {
        _id: projectId,
        title: project.title,
        studentId: String(project.studentId),
        student,
        studentMatNo: String(project.studentMatNo || ""),
        courseName: String(project.courseName || ""),
        courseYear: String(project.courseYear || ""),
        status,
        reviewStatus: page?.reviewStatus || "none",
        score: typeof project.score === "number" ? project.score : null,
        maxScore,
        scoredAt: project.scoredAt ?? null,
        pageId,
        reviewHref: pageId
          ? `/projects/${projectId}/pages/${pageId}`
          : null,
        updatedAt: project.updatedAt,
      };
    });
  },

  async listPublishedForStudent(
    tenantId: string,
    lecturerId: string,
    filters?: { courseYear?: string; courseName?: string },
  ) {
    const lecturer = await userRepository.findSupervisorInUniversity(
      tenantId,
      lecturerId,
    );
    if (!lecturer) return [];
    const briefs = await assignmentBriefRepository.listPublishedByLecturer(
      tenantId,
      lecturerId,
      filters,
    );
    return briefs.map(serializeBrief);
  },

  async get(tenantId: string, id: string) {
    const brief = await assignmentBriefRepository.findById(tenantId, id);
    if (!brief) throw new NotFoundError("Assignment brief not found");
    return serializeBrief(brief);
  },

  async getForLecturer(tenantId: string, id: string, lecturerId: string) {
    const brief = await assignmentBriefRepository.findById(tenantId, id);
    if (!brief) throw new NotFoundError("Assignment brief not found");
    if (String(brief.lecturerId) !== lecturerId) {
      throw new ForbiddenError("You can only manage your own assignment briefs");
    }
    return brief;
  },

  async update(
    tenantId: string,
    id: string,
    lecturerId: string,
    input: UpdateAssignmentBriefInput,
  ) {
    const brief = await this.getForLecturer(tenantId, id, lecturerId);
    const payload = normalizePayload(input);
    for (const [key, value] of Object.entries(payload)) {
      brief.set(key, value);
    }
    await brief.save();
    return serializeBrief(brief);
  },

  async remove(tenantId: string, id: string, lecturerId: string) {
    const deleted = await assignmentBriefRepository.softDelete(
      tenantId,
      id,
      lecturerId,
    );
    if (!deleted) throw new NotFoundError("Assignment brief not found");
    return serializeBrief(deleted);
  },

  /** Public student-facing snapshot (published only, or already attached). */
  async getReadableBrief(
    tenantId: string,
    id: string,
    opts?: { allowDraftForLecturerId?: string },
  ) {
    const brief = await assignmentBriefRepository.findById(tenantId, id);
    if (!brief) return null;
    if (
      brief.status !== "published" &&
      opts?.allowDraftForLecturerId &&
      String(brief.lecturerId) !== opts.allowDraftForLecturerId
    ) {
      return null;
    }
    if (
      brief.status !== "published" &&
      !opts?.allowDraftForLecturerId
    ) {
      // Still allow if already linked — caller decides; default hide drafts
      return null;
    }
    return serializeBrief(brief);
  },
};
