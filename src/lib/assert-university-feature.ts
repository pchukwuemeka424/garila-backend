import { Types } from "mongoose";

import {
	UniversityFeatureDisabledError,
	type UniversityFeatureKey,
} from "./university-features.js";
import { getFeaturesForUniversityId } from "../services/admin-universities.service.js";

export async function assertUniversityFeature(
	universityId: string | Types.ObjectId | null | undefined,
	feature: UniversityFeatureKey,
): Promise<void> {
	const features = await getFeaturesForUniversityId(universityId);
	if (!features[feature]) {
		throw new UniversityFeatureDisabledError(feature);
	}
}
