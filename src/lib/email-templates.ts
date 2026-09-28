import { getAppUrl } from "../config/env.js";

const LOGO_URL = "https://garilai.com/brand/garil-logo.png";
const BRAND_BLUE = "#1d4ed8";
const BRAND_NAVY = "#0f172a";

export function escapeHtml(value: string): string {
	return value
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function brandedShell(options: {
	title: string;
	preview: string;
	eyebrow: string;
	bodyHtml: string;
}): string {
	const appUrl = getAppUrl();
	const year = new Date().getFullYear();

	return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="color-scheme" content="light" />
  <meta name="supported-color-schemes" content="light" />
  <title>${escapeHtml(options.title)}</title>
  <!--[if mso]><noscript><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml></noscript><![endif]-->
</head>
<body style="margin:0;padding:0;background-color:#eef2f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:${BRAND_NAVY};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;mso-hide:all;">
    ${escapeHtml(options.preview)}
  </div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#eef2f7;padding:40px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background-color:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #dbe3ef;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
          <tr>
            <td align="center" style="padding:28px 32px 20px;background-color:#ffffff;border-bottom:1px solid #e8eef6;">
              <a href="${escapeHtml(appUrl)}" style="text-decoration:none;display:inline-block;">
                <img
                  src="${escapeHtml(LOGO_URL)}"
                  alt="Garil AI"
                  width="220"
                  height="52"
                  style="display:block;width:220px;max-width:100%;height:auto;border:0;outline:none;text-decoration:none;"
                />
              </a>
            </td>
          </tr>
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background:linear-gradient(90deg, ${BRAND_BLUE} 0%, #38bdf8 100%);background-color:${BRAND_BLUE};">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 36px 8px;">
              <p style="margin:0 0 18px;font-size:12px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${BRAND_BLUE};">
                ${escapeHtml(options.eyebrow)}
              </p>
              ${options.bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:20px 36px 32px;border-top:1px solid #e8eef6;background-color:#f8fafc;">
              <p style="margin:0 0 6px;font-size:12px;line-height:1.6;color:#64748b;">
                Need help? Visit
                <a href="${escapeHtml(appUrl)}" style="color:${BRAND_BLUE};text-decoration:none;font-weight:600;">garilai.com</a>
              </p>
              <p style="margin:0;font-size:12px;line-height:1.6;color:#94a3b8;">
                &copy; ${year} Garil AI &middot; Governed AI for Research, Instruction and Learning
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function primaryButton(href: string, label: string): string {
	return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;">
      <tr>
        <td align="center" bgcolor="${BRAND_BLUE}" style="border-radius:10px;background-color:${BRAND_BLUE};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${href}" style="height:48px;v-text-anchor:middle;width:260px;" arcsize="16%" stroke="f" fillcolor="${BRAND_BLUE}">
            <w:anchorlock/>
            <center style="color:#ffffff;font-family:Segoe UI,sans-serif;font-size:15px;font-weight:700;">${escapeHtml(label)}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-- -->
          <a href="${href}" style="display:inline-block;padding:14px 28px;font-size:15px;font-weight:700;line-height:1.2;color:#ffffff;text-decoration:none;border-radius:10px;background-color:${BRAND_BLUE};">
            ${escapeHtml(label)}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>
  `.trim();
}

export function buildPasswordResetEmail(input: {
	name: string;
	resetUrl: string;
}): { subject: string; text: string; html: string } {
	const safeName = escapeHtml(input.name);
	const safeUrl = escapeHtml(input.resetUrl);

	const text = [
		`Hi ${input.name},`,
		"",
		"We received a request to reset your Garil AI password.",
		"Open this link to choose a new password (expires in 1 hour):",
		input.resetUrl,
		"",
		"If you did not request this, you can ignore this email.",
	].join("\n");

	const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND_NAVY};">
      Reset your password
    </h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">
      Hi ${safeName},
    </p>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#475569;">
      We received a request to reset your Garil AI password. Use the button below to choose a new one. This link expires in <strong style="color:${BRAND_NAVY};">1 hour</strong>.
    </p>
    ${primaryButton(safeUrl, "Choose a new password")}
    <p style="margin:0 0 8px;font-size:12px;line-height:1.5;color:#64748b;">
      Or copy and paste this link into your browser:
    </p>
    <p style="margin:0 0 24px;padding:12px 14px;font-size:12px;line-height:1.5;word-break:break-all;background-color:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;">
      <a href="${safeUrl}" style="color:${BRAND_BLUE};text-decoration:none;">${safeUrl}</a>
    </p>
    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
      If you did not request a password reset, you can safely ignore this email. Your password will stay the same.
    </p>
  `.trim();

	return {
		subject: "Reset your Garil AI password",
		text,
		html: brandedShell({
			title: "Reset your Garil AI password",
			preview: "Reset your Garil AI password — this link expires in 1 hour.",
			eyebrow: "Account security",
			bodyHtml,
		}),
	};
}

export function buildPasswordChangedEmail(input: {
	name: string;
}): { subject: string; text: string; html: string } {
	const appUrl = getAppUrl();
	const loginUrl = `${appUrl}/login`;
	const safeName = escapeHtml(input.name);
	const safeLoginUrl = escapeHtml(loginUrl);

	const text = [
		`Hi ${input.name},`,
		"",
		"Your Garil AI password was changed successfully.",
		"If you made this change, no further action is needed.",
		`Sign in: ${loginUrl}`,
		"",
		"If you did not change your password, request a new reset link immediately and contact your administrator.",
	].join("\n");

	const bodyHtml = `
    <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;font-weight:700;color:${BRAND_NAVY};">
      Password updated
    </h1>
    <p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#334155;">
      Hi ${safeName},
    </p>
    <p style="margin:0 0 28px;font-size:15px;line-height:1.7;color:#475569;">
      Your Garil AI password was changed successfully. If you made this change, no further action is needed.
    </p>
    ${primaryButton(safeLoginUrl, "Sign in to Garil AI")}
    <p style="margin:0;font-size:13px;line-height:1.6;color:#64748b;">
      If you did not change your password, request a new reset link immediately and contact your administrator.
    </p>
  `.trim();

	return {
		subject: "Your Garil AI password was changed",
		text,
		html: brandedShell({
			title: "Your Garil AI password was changed",
			preview: "Your Garil AI password was changed successfully.",
			eyebrow: "Security notice",
			bodyHtml,
		}),
	};
}
