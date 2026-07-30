/**
 * Free / consumer mailbox providers — not allowed for lecturer registration.
 * Lecturers must use an institutional university or professional (work) email.
 */
const FREE_EMAIL_DOMAINS = new Set([
	"gmail.com",
	"googlemail.com",
	"outlook.com",
	"hotmail.com",
	"hotmail.co.uk",
	"live.com",
	"msn.com",
	"yahoo.com",
	"yahoo.co.uk",
	"yahoo.co.in",
	"ymail.com",
	"rocketmail.com",
	"icloud.com",
	"me.com",
	"mac.com",
	"aol.com",
	"protonmail.com",
	"proton.me",
	"pm.me",
	"zoho.com",
	"zohomail.com",
	"mail.com",
	"email.com",
	"gmx.com",
	"gmx.net",
	"gmx.de",
	"yandex.com",
	"yandex.ru",
	"mail.ru",
	"inbox.com",
	"qq.com",
	"163.com",
	"126.com",
	"rediffmail.com",
	"tutanota.com",
	"tuta.io",
	"fastmail.com",
	"hey.com",
	"mailinator.com",
	"guerrillamail.com",
	"tempmail.com",
	"10minutemail.com",
]);

export function emailDomain(email: string): string | null {
	const trimmed = email.trim().toLowerCase();
	const at = trimmed.lastIndexOf("@");
	if (at < 1 || at === trimmed.length - 1) return null;
	return trimmed.slice(at + 1);
}

/** True when the address uses a known free/consumer email provider. */
export function isFreeEmail(email: string): boolean {
	const domain = emailDomain(email);
	if (!domain) return false;
	for (const free of FREE_EMAIL_DOMAINS) {
		if (domain === free || domain.endsWith(`.${free}`)) return true;
	}
	/* Regional consumer brands not exhaustively listed (yahoo.*, hotmail.*, outlook.*) */
	const labels = domain.split(".");
	if (labels.includes("yahoo") || labels.includes("hotmail") || labels.includes("outlook")) {
		return true;
	}
	return false;
}

export const LECTURER_FREE_EMAIL_ERROR =
	"Lecturer accounts require an institutional university or professional email. Free email providers (Gmail, Outlook, Yahoo, etc.) are not allowed.";
