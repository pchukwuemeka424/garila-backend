/**
 * Derive faculty / department / programme / cohort from free-text user fields
 * and the institutional department catalogue.
 */

export type OrgDimensions = {
	faculty: string;
	department: string;
	programme: string;
	cohort: string;
};

const FACULTY_BY_DEPT_LABEL: Record<string, string> = {
	"Civil Engineering": "Engineering & Technology",
	"Mechanical Engineering": "Engineering & Technology",
	"Electrical & Electronics Engineering": "Engineering & Technology",
	"Computer Engineering": "Engineering & Technology",
	"Chemical Engineering": "Engineering & Technology",
	"Petroleum Engineering": "Engineering & Technology",
	"Agricultural Engineering": "Engineering & Technology",
	"Industrial & Production Engineering": "Engineering & Technology",
	"Metallurgical & Materials Engineering": "Engineering & Technology",
	"Systems Engineering": "Engineering & Technology",
	Architecture: "Engineering & Technology",
	"Building Technology": "Engineering & Technology",
	"Quantity Surveying": "Engineering & Technology",
	"Estate Management": "Engineering & Technology",
	"Urban & Regional Planning": "Engineering & Technology",
	"Surveying & Geoinformatics": "Engineering & Technology",
	"Computer Science": "Computing & Information Technology",
	"Information Technology": "Computing & Information Technology",
	"Software Engineering": "Computing & Information Technology",
	"Information Systems": "Computing & Information Technology",
	"Cyber Security": "Computing & Information Technology",
	"Data Science & Analytics": "Computing & Information Technology",
	"Library & Information Science": "Computing & Information Technology",
	Mathematics: "Physical & Life Sciences",
	Statistics: "Physical & Life Sciences",
	Physics: "Physical & Life Sciences",
	Chemistry: "Physical & Life Sciences",
	Biochemistry: "Physical & Life Sciences",
	Microbiology: "Physical & Life Sciences",
	Biology: "Physical & Life Sciences",
	Botany: "Physical & Life Sciences",
	Zoology: "Physical & Life Sciences",
	Geology: "Physical & Life Sciences",
	"Medicine & Surgery": "Health Sciences",
	Nursing: "Health Sciences",
	Pharmacy: "Health Sciences",
	"Medical Laboratory Science": "Health Sciences",
	Physiotherapy: "Health Sciences",
	"Public Health": "Health Sciences",
	Law: "Law & Social Sciences",
	Economics: "Law & Social Sciences",
	"Political Science": "Law & Social Sciences",
	Sociology: "Law & Social Sciences",
	Psychology: "Law & Social Sciences",
	"Mass Communication": "Arts & Humanities",
	"English Language": "Arts & Humanities",
	History: "Arts & Humanities",
	"Business Administration": "Management Sciences",
	Accounting: "Management Sciences",
	Banking: "Management Sciences",
	Finance: "Management Sciences",
	Marketing: "Management Sciences",
	"Education": "Education",
};

const COHORT_RE = /\(([^)]+)\)\s*$/;

export function parseDepartmentField(raw?: string | null): {
	department: string;
	cohort: string | null;
} {
	const value = (raw ?? "").trim();
	if (!value) return { department: "Unassigned", cohort: null };
	const match = value.match(COHORT_RE);
	if (!match) return { department: value, cohort: null };
	const cohort = match[1]?.trim() || null;
	const department = value.replace(COHORT_RE, "").trim() || value;
	return { department, cohort };
}

export function resolveFaculty(department: string): string {
	if (!department || department === "Unassigned") return "Unassigned";
	const exact = FACULTY_BY_DEPT_LABEL[department];
	if (exact) return exact;
	const lower = department.toLowerCase();
	for (const [label, faculty] of Object.entries(FACULTY_BY_DEPT_LABEL)) {
		if (lower.includes(label.toLowerCase()) || label.toLowerCase().includes(lower)) {
			return faculty;
		}
	}
	if (/engineer|architect|survey/i.test(department)) return "Engineering & Technology";
	if (/computer|software|cyber|data|information tech/i.test(department)) {
		return "Computing & Information Technology";
	}
	if (/medic|nurs|pharm|health/i.test(department)) return "Health Sciences";
	if (/law|econ|politic|socio|psych/i.test(department)) return "Law & Social Sciences";
	if (/account|market|financ|business|bank/i.test(department)) return "Management Sciences";
	if (/educat/i.test(department)) return "Education";
	if (/math|phys|chem|bio|stat|geo/i.test(department)) return "Physical & Life Sciences";
	return "Other";
}

export function resolveProgramme(role: string, department: string, scope?: string | null): string {
	if (scope === "undergraduate") return `${department} — Undergraduate`;
	if (scope === "masters") return `${department} — Masters`;
	if (scope === "doctoral") return `${department} — Doctoral`;
	if (scope === "faculty") return `${department} — Faculty research`;
	if (role === "student") return `${department} — Student`;
	if (role === "lecturer" || role === "researcher") return `${department} — Staff`;
	return department;
}

export function resolveCohort(role: string, cohortFromDept: string | null, createdAt?: Date | null): string {
	if (cohortFromDept) return cohortFromDept;
	if (createdAt) {
		const year = createdAt.getFullYear();
		return role === "student" ? `Intake ${year}` : `Staff ${year}`;
	}
	return "Unassigned";
}

export function orgDimensionsForUser(user: {
	role?: string | null;
	department?: string | null;
	faculty?: string | null;
	programme?: string | null;
	cohort?: string | null;
	createdAt?: Date | null;
}): OrgDimensions {
	const parsed = parseDepartmentField(user.department);
	const department = parsed.department;
	const faculty = (user.faculty ?? "").trim() || resolveFaculty(department);
	const programme =
		(user.programme ?? "").trim() || resolveProgramme(user.role ?? "lecturer", department);
	const cohort =
		(user.cohort ?? "").trim() ||
		resolveCohort(user.role ?? "lecturer", parsed.cohort, user.createdAt ?? null);
	return { faculty, department, programme, cohort };
}
