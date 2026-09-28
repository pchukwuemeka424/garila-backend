import { Types } from "mongoose";

import {
	PlatformLegalDocumentModel,
	type PublicLegalDocumentId,
} from "../db/models/PlatformLegalDocument.js";
import { ACCOUNT_POLICY_VERSION } from "../lib/policy-consent.js";
import { recordAuditEvent } from "./admin-audit.service.js";

const APP_NAME = "GARIL AI";

export type LegalSection = {
	title: string;
	paragraphs: string[];
};

export type LegalDocumentRecord = {
	id: PublicLegalDocumentId;
	title: string;
	updatedLabel: string;
	intro: string;
	sections: LegalSection[];
	version: string;
	updatedAt: string;
};

export type LegalDocumentUpdateInput = {
	title: string;
	intro: string;
	sections: LegalSection[];
};

const PUBLIC_IDS: PublicLegalDocumentId[] = ["terms", "privacy", "aup"];

const DEFAULT_TERMS: Omit<LegalDocumentRecord, "updatedAt"> = {
	id: "terms",
	title: "Terms of Service",
	updatedLabel: `Policy version ${ACCOUNT_POLICY_VERSION} · Placeholder for counsel-approved terms`,
	intro: `${APP_NAME} is a governed AI workspace for research, instruction, and learning in higher education. These Terms describe the conditions for creating an account and using the platform. Final binding language will replace this placeholder.`,
	sections: [
		{
			title: "Accounts and institutional access",
			paragraphs: [
				"You may register only if your institution is onboarded on the platform and you provide accurate account details.",
				"You are responsible for safeguarding your credentials and for activity under your account.",
				"Account access may be suspended or removed where institutional or platform rules require it.",
			],
		},
		{
			title: "Acceptable use",
			paragraphs: [
				"Use the platform for legitimate academic work within your institution’s policies.",
				"Do not misuse the service to harass others, attempt unauthorized access, or circumvent governance controls.",
				"AI tools assist academic work; they do not replace your judgement, authorship, or institutional rules.",
			],
		},
		{
			title: "AI-assisted outputs",
			paragraphs: [
				"Outputs may be drafts or suggestions. You remain accountable for accuracy, originality, citations, and any work you submit for assessment or publication.",
				"Follow your university, faculty, and supervisor requirements on AI disclosure and academic integrity.",
			],
		},
		{
			title: "Changes",
			paragraphs: [
				"We may update these Terms as the product evolves. Material changes may require renewed acceptance at registration or sign-in.",
			],
		},
	],
	version: ACCOUNT_POLICY_VERSION,
};

const DEFAULT_PRIVACY: Omit<LegalDocumentRecord, "updatedAt"> = {
	id: "privacy",
	title: "Privacy Policy",
	updatedLabel: `Policy version ${ACCOUNT_POLICY_VERSION} · Placeholder for counsel-approved privacy notice`,
	intro: `${APP_NAME} processes personal and academic data to provide a governed workspace for higher education. This page outlines the categories of information involved. Final binding language will replace this placeholder.`,
	sections: [
		{
			title: "Information we process",
			paragraphs: [
				"Account details such as name, email, institution, department or programme, and role.",
				"Usage and security data needed to operate the service, including authentication and session activity.",
				"Content you submit in academic tools (for example research drafts, notebooks, or uploads) as required to provide those features.",
			],
		},
		{
			title: "How we use information",
			paragraphs: [
				"To create and manage your account, authenticate you, and tailor the workspace to your role and institution.",
				"To deliver AI-assisted academic features under institutional governance controls.",
				"To support integrity, security, and compliance processes where your institution enables them.",
			],
		},
		{
			title: "Cookies",
			paragraphs: [
				"Essential cookies keep the site working. Optional cookies may help understand product usage. You can accept or decline optional cookies via the cookie banner available from the site footer.",
			],
		},
		{
			title: "Retention and institutional controls",
			paragraphs: [
				"Retention and access may follow institutional policies configured for your university, including research privacy and retention settings.",
				"Contact your institutional administrator for local data-protection questions, or email hello@trustledai.com for platform privacy enquiries.",
			],
		},
	],
	version: ACCOUNT_POLICY_VERSION,
};

const DEFAULT_AUP: Omit<LegalDocumentRecord, "updatedAt"> = {
	id: "aup",
	title: "Acceptable Use Policy",
	updatedLabel: `Policy version ${ACCOUNT_POLICY_VERSION} · Placeholder for counsel-approved acceptable use rules`,
	intro: `${APP_NAME} provides governed AI tools for higher education. This Acceptable Use Policy describes permitted and prohibited uses of the platform. Final binding language will replace this placeholder.`,
	sections: [
		{
			title: "Permitted use",
			paragraphs: [
				"Use the platform for legitimate academic work within your institution’s policies.",
				"AI tools assist academic work; they do not replace your judgement, authorship, or institutional rules.",
			],
		},
		{
			title: "Prohibited use",
			paragraphs: [
				"Do not misuse the service to harass others, attempt unauthorized access, or circumvent governance controls.",
				"Do not use the platform to generate content that violates academic integrity, institutional policy, or applicable law.",
			],
		},
		{
			title: "Accountability",
			paragraphs: [
				"You remain accountable for accuracy, originality, citations, and any work you submit for assessment or publication.",
				"Follow your university, faculty, and supervisor requirements on AI disclosure and academic integrity.",
			],
		},
	],
	version: ACCOUNT_POLICY_VERSION,
};

const DEFAULTS: Record<PublicLegalDocumentId, Omit<LegalDocumentRecord, "updatedAt">> = {
	terms: DEFAULT_TERMS,
	privacy: DEFAULT_PRIVACY,
	aup: DEFAULT_AUP,
};

function isPublicId(value: string): value is PublicLegalDocumentId {
	return PUBLIC_IDS.includes(value as PublicLegalDocumentId);
}

function toRecord(doc: {
	id: string;
	title?: string | null;
	intro?: string | null;
	sections?: { title?: string | null; paragraphs?: string[] | null }[] | null;
	updatedLabel?: string | null;
	version?: string | null;
	updatedAt?: Date;
}): LegalDocumentRecord {
	if (!isPublicId(doc.id)) {
		throw new Error(`Invalid legal document id: ${doc.id}`);
	}
	return {
		id: doc.id,
		title: doc.title ?? "",
		intro: doc.intro ?? "",
		sections: (doc.sections ?? []).map((section) => ({
			title: section.title ?? "",
			paragraphs: (section.paragraphs ?? []).map((p) => String(p)),
		})),
		updatedLabel: doc.updatedLabel ?? "",
		version: doc.version ?? "1",
		updatedAt: (doc.updatedAt ?? new Date()).toISOString(),
	};
}

function normalizeSections(sections: LegalSection[]): LegalSection[] {
	return sections
		.map((section) => ({
			title: section.title.trim(),
			paragraphs: (section.paragraphs ?? [])
				.map((p) => p.trim())
				.filter(Boolean),
		}))
		.filter((section) => section.title.length > 0 && section.paragraphs.length > 0);
}

function validateUpdate(input: LegalDocumentUpdateInput): LegalDocumentUpdateInput {
	const title = input.title.trim();
	const intro = input.intro.trim();
	const sections = normalizeSections(input.sections ?? []);
	if (title.length < 2) throw new Error("Title is required.");
	if (intro.length < 2) throw new Error("Intro is required.");
	if (sections.length < 1) throw new Error("Add at least one section with paragraphs.");
	return { title, intro, sections };
}

function formatUpdatedLabel(version: string): string {
	const date = new Date().toLocaleDateString("en-GB", {
		year: "numeric",
		month: "short",
		day: "numeric",
	});
	return `Policy version ${version} · Updated ${date}`;
}

function bumpVersion(current: string): string {
	const n = Number.parseInt(current, 10);
	if (Number.isFinite(n) && n >= 1) return String(n + 1);
	return "2";
}

/** Seed default Terms / Privacy / AUP + meta policy version if missing. */
export async function ensureDefaultLegalDocuments(): Promise<void> {
	await PlatformLegalDocumentModel.updateOne(
		{ id: "meta" },
		{
			$setOnInsert: {
				id: "meta",
				title: "Legal meta",
				intro: "",
				sections: [],
				updatedLabel: "",
				version: ACCOUNT_POLICY_VERSION,
				accountPolicyVersion: ACCOUNT_POLICY_VERSION,
			},
		},
		{ upsert: true },
	);

	for (const id of PUBLIC_IDS) {
		const seed = DEFAULTS[id];
		await PlatformLegalDocumentModel.updateOne(
			{ id },
			{
				$setOnInsert: {
					id: seed.id,
					title: seed.title,
					intro: seed.intro,
					sections: seed.sections,
					updatedLabel: seed.updatedLabel,
					version: seed.version,
					accountPolicyVersion: ACCOUNT_POLICY_VERSION,
				},
			},
			{ upsert: true },
		);
	}
}

export async function getAccountPolicyVersion(): Promise<string> {
	await ensureDefaultLegalDocuments();
	const meta = await PlatformLegalDocumentModel.findOne({ id: "meta" }).lean();
	return meta?.accountPolicyVersion?.trim() || ACCOUNT_POLICY_VERSION;
}

export async function getLegalDocument(id: string): Promise<LegalDocumentRecord> {
	if (!isPublicId(id)) throw new Error("Unknown legal document.");
	await ensureDefaultLegalDocuments();
	const doc = await PlatformLegalDocumentModel.findOne({ id }).lean();
	if (!doc) {
		const fallback = DEFAULTS[id];
		return { ...fallback, updatedAt: new Date().toISOString() };
	}
	return toRecord(doc);
}

export async function listLegalDocuments(): Promise<{
	documents: LegalDocumentRecord[];
	accountPolicyVersion: string;
}> {
	await ensureDefaultLegalDocuments();
	const [docs, accountPolicyVersion] = await Promise.all([
		PlatformLegalDocumentModel.find({ id: { $in: PUBLIC_IDS } }).lean(),
		getAccountPolicyVersion(),
	]);
	const byId = new Map(docs.map((d) => [d.id, d]));
	const documents = PUBLIC_IDS.map((id) => {
		const row = byId.get(id);
		if (row) return toRecord(row);
		return { ...DEFAULTS[id], updatedAt: new Date().toISOString() };
	});
	return { documents, accountPolicyVersion };
}

export async function updateLegalDocument(
	id: string,
	input: LegalDocumentUpdateInput,
	actorId: string,
): Promise<{ document: LegalDocumentRecord; accountPolicyVersion: string }> {
	if (!isPublicId(id)) throw new Error("Unknown legal document.");
	const body = validateUpdate(input);
	await ensureDefaultLegalDocuments();

	const currentVersion = await getAccountPolicyVersion();
	const nextVersion = bumpVersion(currentVersion);
	const updatedLabel = formatUpdatedLabel(nextVersion);
	const actorObjectId = Types.ObjectId.isValid(actorId) ? new Types.ObjectId(actorId) : undefined;

	const doc = await PlatformLegalDocumentModel.findOneAndUpdate(
		{ id },
		{
			$set: {
				title: body.title,
				intro: body.intro,
				sections: body.sections,
				updatedLabel,
				version: nextVersion,
				updatedBy: actorObjectId,
			},
		},
		{ new: true },
	).lean();

	if (!doc) throw new Error("Legal document not found.");

	await PlatformLegalDocumentModel.updateOne(
		{ id: "meta" },
		{
			$set: {
				accountPolicyVersion: nextVersion,
				version: nextVersion,
				updatedBy: actorObjectId,
				updatedLabel,
			},
		},
	);

	await recordAuditEvent({
		action: "legal.updated",
		category: "admin",
		actorId,
		summary: `Updated legal document “${body.title}” (${id}) to policy version ${nextVersion}`,
		targetType: "legal_document",
		targetId: id,
		details: { documentId: id, accountPolicyVersion: nextVersion },
	});

	return {
		document: toRecord(doc),
		accountPolicyVersion: nextVersion,
	};
}

export { PUBLIC_IDS as LEGAL_PUBLIC_IDS };
