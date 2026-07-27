import { connectMongo, disconnectMongo } from "../src/db/connect.js";
import { ensureDefaultAdmin } from "../src/services/bootstrap-admin.service.js";

async function main() {
	await connectMongo();
	await ensureDefaultAdmin();
	await disconnectMongo();
	console.log("Default admin ready.");
}

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
