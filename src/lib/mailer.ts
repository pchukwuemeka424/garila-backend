import { getMailFrom, getResendApiKey } from "../config/env.js";

export type MailMessage = {
	to: string;
	subject: string;
	text: string;
	html?: string;
};

/**
 * Sends transactional email when Resend is configured (`RESEND_API_KEY`).
 * Without a provider, logs the message (dev-friendly) and returns `{ delivered: false }`.
 */
export async function sendMail(message: MailMessage): Promise<{ delivered: boolean; via: string }> {
	const resendKey = getResendApiKey();
	if (resendKey) {
		const res = await fetch("https://api.resend.com/emails", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${resendKey}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify({
				from: getMailFrom(),
				to: [message.to],
				subject: message.subject,
				text: message.text,
				html: message.html ?? undefined,
			}),
		});
		if (!res.ok) {
			const body = await res.text().catch(() => "");
			throw new Error(`Resend failed (${res.status}): ${body || res.statusText}`);
		}
		return { delivered: true, via: "resend" };
	}

	console.log(
		[
			"[mailer] RESEND_API_KEY not set — email logged for local development:",
			`To: ${message.to}`,
			`Subject: ${message.subject}`,
			message.text,
		].join("\n"),
	);
	return { delivered: false, via: "console" };
}
