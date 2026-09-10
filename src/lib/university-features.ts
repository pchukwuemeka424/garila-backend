export const UNIVERSITY_FEATURE_KEYS = [
	"researchAssistant",
	"researchNotebook",
	"studentAssessment",
	"supervisionAssistant",
	"advancedResearch",
] as const;

export type UniversityFeatureKey = (typeof UNIVERSITY_FEATURE_KEYS)[number];

export type UniversityFeatures = Record<UniversityFeatureKey, boolean>;

export const DEFAULT_UNIVERSITY_FEATURES: UniversityFeatures = {
	researchAssistant: true,
	researchNotebook: true,
	studentAssessment: true,
	supervisionAssistant: true,
	advancedResearch: true,
};

export function normalizeUniversityFeatures(
	raw: Partial<UniversityFeatures> | null | undefined,
): UniversityFeatures {
	const out = { ...DEFAULT_UNIVERSITY_FEATURES };
	if (!raw || typeof raw !== "object") return out;
	for (const key of UNIVERSITY_FEATURE_KEYS) {
		if (typeof raw[key] === "boolean") out[key] = raw[key];
	}
	return out;
}

export function mergeUniversityFeatures(
	current: Partial<UniversityFeatures> | null | undefined,
	patch: Partial<UniversityFeatures>,
): UniversityFeatures {
	const base = normalizeUniversityFeatures(current);
	for (const key of UNIVERSITY_FEATURE_KEYS) {
		if (typeof patch[key] === "boolean") base[key] = patch[key]!;
	}
	return base;
}

export class UniversityFeatureDisabledError extends Error {
	statusCode = 403 as const;
	constructor(public feature: UniversityFeatureKey) {
		super(`This module is disabled for your university (${feature}).`);
	}
}
