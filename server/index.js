import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { createApiApp } from "./app.js";
import { createDatabase } from "./database.js";

const defaultDatabasePath = fileURLToPath(new URL("../data/inventory.sqlite", import.meta.url));

export function startServer() {
	const database = createDatabase(process.env.DB_PATH || defaultDatabasePath);
	const app = createApiApp(database);
	const server = createServer(app);
	const port = Number(process.env.PORT || 3001);

	server.on("error", (error) => {
		console.error("Could not start the inventory server:", error.message);
		database.close();
		process.exitCode = 1;
	});
	server.listen(port, process.env.HOST || "0.0.0.0", () => {
		console.log(`Inventory API listening on http://localhost:${port}`);
	});

	for (const signal of ["SIGINT", "SIGTERM"]) {
		process.on(signal, () => {
			server.close((error) => {
				database.close();
				if (error) {
					console.error("Could not shut down the inventory server cleanly:", error.message);
					process.exitCode = 1;
				}
			});
		});
	}

	return server;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
	startServer();
}
