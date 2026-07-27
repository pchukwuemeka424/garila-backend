/** PM2 — standalone backend. From repo root: `pm2 start ecosystem.config.cjs` */
module.exports = {
	apps: [
		{
			name: "garil-backend",
			cwd: __dirname,
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
