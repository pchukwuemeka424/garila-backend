import { PortalNotificationModel } from "../../db/models/PortalNotification.js";
import { PortalProjectModel } from "../../db/models/PortalProject.js";
import { NotFoundError } from "../../lib/portal-errors.js";

type NotifyInput = {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channels?: string[];
};

export const notificationService = {
  /** Creates an in-app notification within the caller tenant. */
  create(tenantId: string, userId: string, input: NotifyInput) {
    return PortalNotificationModel.create({ universityId: tenantId, userId, ...input });
  },

  async listForUser(tenantId: string, userId: string, limit = 40) {
    return PortalNotificationModel.find({ universityId: tenantId, userId })
      .sort({ createdAt: -1 })
      .limit(limit);
  },

  async unreadCount(tenantId: string, userId: string) {
    return PortalNotificationModel.countDocuments({
      universityId: tenantId,
      userId,
      readAt: { $exists: false },
    });
  },

  async markRead(tenantId: string, userId: string, id: string) {
    const notification = await PortalNotificationModel.findOne({
      _id: id,
      universityId: tenantId,
      userId,
    });
    if (!notification) throw new NotFoundError("Notification not found");
    if (!notification.readAt) {
      notification.readAt = new Date();
      await notification.save();
    }
    return notification;
  },

  async markAllRead(tenantId: string, userId: string) {
    await PortalNotificationModel.updateMany(
      { universityId: tenantId, userId, readAt: { $exists: false } },
      { $set: { readAt: new Date() } },
    );
    return { ok: true };
  },

  /** Notifies student + supervisors linked to a project. */
  async notifyProjectStakeholders(
    tenantId: string,
    projectId: string,
    input: NotifyInput,
  ) {
    const project = await PortalProjectModel.findOne({
      _id: projectId,
      universityId: tenantId,
      deletedAt: { $exists: false },
    });
    if (!project) return [];

    const recipients = [
      project.studentId,
      project.supervisorId,
      project.coSupervisorId,
    ].filter(Boolean);

    const unique = [...new Set(recipients.map(String))];
    return Promise.all(
      unique.map((userId) =>
        PortalNotificationModel.create({ universityId: tenantId, userId, ...input }),
      ),
    );
  },
};
