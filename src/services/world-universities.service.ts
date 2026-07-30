export type CatalogueUniversity = {
	id: string;
	label: string;
};

type HipolabsUniversity = {
	name?: string;
	domains?: string[];
};

const COUNTRY_API_NAMES: Record<string, string> = {
	GB: "United Kingdom",
	US: "United States",
	GH: "Ghana",
	KE: "Kenya",
	ZA: "South Africa",
	CA: "Canada",
	IN: "India",
};

const cache = new Map<string, { at: number; universities: CatalogueUniversity[] }>();
const CACHE_TTL_MS = 1000 * 60 * 60; // 1 hour

function slugify(value: string): string {
	return value
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, 80);
}

function toUniversity(entry: HipolabsUniversity, countryCode: string): CatalogueUniversity | null {
	const name = entry.name?.trim();
	if (!name) return null;
	const domain = entry.domains?.[0]?.trim().toLowerCase();
	const id = domain
		? `${countryCode.toLowerCase()}-${slugify(domain)}`
		: `${countryCode.toLowerCase()}-${slugify(name)}`;
	return { id, label: name };
}

export function supportedCatalogueCountry(code: string): boolean {
	return code in COUNTRY_API_NAMES;
}

export async function listUniversitiesForCountry(countryCode: string): Promise<CatalogueUniversity[]> {
	const code = countryCode.trim().toUpperCase();
	const apiCountry = COUNTRY_API_NAMES[code];
	if (!apiCountry) {
		throw new Error("Unsupported country for university catalogue.");
	}

	const cached = cache.get(code);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
		return cached.universities;
	}

	const url = `http://universities.hipolabs.com/search?country=${encodeURIComponent(apiCountry)}`;
	const res = await fetch(url);
	if (!res.ok) {
		throw new Error(`Could not load universities for ${apiCountry}.`);
	}

	const data = (await res.json()) as HipolabsUniversity[];
	if (!Array.isArray(data)) {
		throw new Error(`Unexpected university catalogue response for ${apiCountry}.`);
	}

	const seen = new Set<string>();
	const universities: CatalogueUniversity[] = [];
	for (const entry of data) {
		const university = toUniversity(entry, code);
		if (!university || seen.has(university.id)) continue;
		seen.add(university.id);
		universities.push(university);
	}

	universities.sort((a, b) => a.label.localeCompare(b.label));
	cache.set(code, { at: Date.now(), universities });
	return universities;
}
