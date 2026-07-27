import { UserModel } from "../db/models/User.js";

export type NotificationChannel = "in_app" | "email" | "webhook";

export type NotificationPayload = {
	title: string;
	body: string;
	severity: "low" | "medium" | "high" | "critical";
	category: string;
	targetUrl?: string;
	metadata?: Record<string, unknown>;
};

export type NotificationConfig = {
	channels: NotificationChannel[];
	webhookUrl?: string;
	emailRecipients?: string[];
};

const DEFAULT_CONFIG: NotificationConfig = {
	channels: ["in_app"],
};

export async function sendGovernanceNotification(
	payload: NotificationPayload,
	config: NotificationConfig = DEFAULT_CONFIG,
): Promise<{ sent: NotificationChannel[]; errors: string[] }> {
	const sent: NotificationChannel[] = [];
	const errors: string[] = [];

	for (const channel of config.channels) {
		try {
			switch (channel) {
				case "in_app":
					await sendInAppNotification(payload);
					sent.push("in_app");
					break;
				case "email":
					await sendEmailNotification(payload, config.emailRecipients ?? []);
					sent.push("email");
					break;
				case "webhook":
					if (config.webhookUrl) {
						await sendWebhookNotification(payload, config.webhookUrl);
						sent.push("webhook");
					} else {
						errors.push("Webhook URL not configured.");
					}
					break;
			}
		} catch (err) {
			errors.push(`${channel}: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	return { sent, errors };
}

async function sendInAppNotification(payload: NotificationPayload): Promise<void> {
	console.log(`[Notification:in_app] ${payload.severity.toUpperCase()} - ${payload.title}: ${payload.body}`);
}

async function sendEmailNotification(
	payload: NotificationPayload,
	recipients: string[],
): Promise<void> {
	if (recipients.length === 0) {
		const admins = await UserModel.find({
			role: { $in: ["admin", "governance_admin"] },
			status: "active",
		})
			.select("email")
			.lean();
		recipients = admins.map((a) => a.email);
	}

	console.log(
		`[Notification:email] To: ${recipients.join(", ")} | ${payload.severity.toUpperCase()} - ${payload.title}`,
	);
}

async function sendWebhookNotification(
	payload: NotificationPayload,
	url: string,
): Promise<void> {
	try {
		const response = await fetch(url, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				text: `[${payload.severity.toUpperCase()}] ${payload.title}\n${payload.body}`,
				...payload,
				timestamp: new Date().toISOString(),
			}),
			signal: AbortSignal.timeout(10_000),
		});
		if (!response.ok) {
			throw new Error(`Webhook returned ${response.status}`);
		}
	} catch (err) {
		throw new Error(`Webhook failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export async function notifyOnAlert(alert: {
	title: string;
	summary: string;
	severity: string;
	kind: string;
}): Promise<void> {
	await sendGovernanceNotification({
		title: `Alert: ${alert.title}`,
		body: alert.summary,
		severity: alert.severity as NotificationPayload["severity"],
		category: alert.kind,
		targetUrl: "/admin/alerts",
	});
}

export async function notifyOnIncident(incident: {
	title: string;
	description: string;
	severity: string;
	kind: string;
}): Promise<void> {
	await sendGovernanceNotification({
		title: `Incident: ${incident.title}`,
		body: incident.description,
		severity: incident.severity as NotificationPayload["severity"],
		category: incident.kind,
		targetUrl: "/admin/incidents",
	});
}

export async function notifyOnPolicyViolation(details: {
	policyName: string;
	userId: string;
	action: string;
}): Promise<void> {
	await sendGovernanceNotification({
		title: `Policy Violation: ${details.policyName}`,
		body: `User ${details.userId} attempted blocked action: ${details.action}`,
		severity: "high",
		category: "policy_violation",
		targetUrl: "/admin/audit",
	});
}

export async function notifyOnEscalation(details: {
	title: string;
	severity: string;
	type: "alert" | "incident";
}): Promise<void> {
	await sendGovernanceNotification({
		title: `Escalated ${details.type}: ${details.title}`,
		body: `A ${details.severity} ${details.type} has been escalated and requires immediate attention.`,
		severity: "critical",
		category: "escalation",
		targetUrl: details.type === "alert" ? "/admin/alerts" : "/admin/incidents",
	});
}
