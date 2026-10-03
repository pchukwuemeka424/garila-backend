/**
 * API paths that may be called without Authentication.
 * Everything else under /api/* is default-deny (auth required).
 */
const PUBLIC_EXACT = new Set([
	"GET /api/health",
	"GET /api/auth/universities",
	"GET /api/auth/universities/catalogue",
	"POST /api/auth/register",
	"POST /api/auth/register-student",
	"POST /api/auth/login",
	"POST /api/auth/forgot-password",
	"POST /api/auth/reset-password",
	"GET /api/legal",
]);

const PUBLIC_PREFIXES: Array<{ method: string; prefix: string }> = [
	{ method: "GET", prefix: "/api/legal/" },
];

export function isPublicApiRoute(method: string, urlPath: string): boolean {
	const path = urlPath.split("?")[0] ?? "";
	const key = `${method.toUpperCase()} ${path}`;
	if (PUBLIC_EXACT.has(key)) return true;
	for (const entry of PUBLIC_PREFIXES) {
		if (method.toUpperCase() === entry.method && path.startsWith(entry.prefix)) {
			return true;
		}
	}
	return false;
}
