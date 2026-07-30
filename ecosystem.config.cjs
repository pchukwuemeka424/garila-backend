/** PM2 — backend API only. From repo root: `pm2 start deploy/backend/ecosystem.config.cjs` */
const path = require("node:path");

const root = path.resolve(__dirname, "../..");

module.exports = {
	apps: [
		{
			name: "garil-backend",
			cwd: path.join(root, "backend"),
			script: "dist/index.js",
			interpreter: "node",
			instances: 1,
			exec_mode: "fork",
			env: {
				NODE_ENV: "production",
			},
			max_memory_restart: "1G",
			time: true,
		},
	],
};
