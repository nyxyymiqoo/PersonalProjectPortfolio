import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createApiApp } from "../server/app.js";
import { createDatabase } from "../server/database.js";

async function startTestServer(t, databasePath = join(mkdtempSync(join(tmpdir(), "stockroom-api-")), "test.sqlite"), seed = false) {
	const database = createDatabase(databasePath, { seed });
	const server = createServer(createApiApp(database));
	server.listen(0, "127.0.0.1");
	await once(server, "listening");

	let closed = false;
	const close = async () => {
		if (closed) return;
		closed = true;
		if (server.listening) {
			const closedServer = new Promise((resolve, reject) => {
				server.close((error) => error ? reject(error) : resolve());
			});
			server.closeAllConnections();
			await closedServer;
		}
		database.close();
	};

	t.after(async () => {
		await close();
		rmSync(join(databasePath, ".."), { recursive: true, force: true });
	});

	return {
		databasePath,
		database,
		baseUrl: `http://127.0.0.1:${server.address().port}`,
		close
	};
}

async function send(baseUrl, route, { method = "GET", body, headers = {} } = {}) {
	const response = await fetch(`${baseUrl}${route}`, {
		method,
		headers: {
			connection: "close",
			...(body === undefined ? {} : { "content-type": "application/json" }),
			...headers
		},
		...(body === undefined ? {} : { body: JSON.stringify(body) })
	});
	return { response, data: await response.json() };
}

async function createTestProduct(baseUrl, sku = "TEST-001") {
	const { response, data } = await send(baseUrl, "/api/products", {
		method: "POST",
		body: { title: "Test desk lamp", sku, category: "Home & Living", price: 39.5, lowStockThreshold: 4 }
	});
	assert.equal(response.status, 201);
	return data.product;
}

test("product creation validates required fields and rejects duplicate SKUs", async (t) => {
	const { baseUrl } = await startTestServer(t);

	const invalid = await send(baseUrl, "/api/products", {
		method: "POST",
		body: { title: "Missing SKU", category: "Home", price: 10 }
	});
	assert.equal(invalid.response.status, 400);
	assert.equal(invalid.data.error.code, "INVALID_PRODUCT");

	const product = await createTestProduct(baseUrl, "test-001");
	assert.equal(product.sku, "TEST-001");
	assert.equal(product.stock, 0);

	const duplicate = await send(baseUrl, "/api/products", {
		method: "POST",
		body: { title: "Duplicate", sku: "test-001", category: "Home", price: 1 }
	});
	assert.equal(duplicate.response.status, 409);
	assert.equal(duplicate.data.error.code, "DUPLICATE_SKU");
});

test("create, receive, remove, and read back a persisted stock balance", async (t) => {
	const context = await startTestServer(t);
	const product = await createTestProduct(context.baseUrl);
	const key = "movement-create-receive-001";
	const receipt = await send(context.baseUrl, `/api/products/${product.id}/movements`, {
		method: "POST",
		headers: { "Idempotency-Key": key },
		body: { type: "receive", quantity: 12, note: "Supplier delivery" }
	});
	assert.equal(receipt.response.status, 201);
	assert.equal(receipt.data.product.stock, 12);

	const repeatedReceipt = await send(context.baseUrl, `/api/products/${product.id}/movements`, {
		method: "POST",
		headers: { "Idempotency-Key": key },
		body: { type: "receive", quantity: 12, note: "Supplier delivery" }
	});
	assert.equal(repeatedReceipt.response.status, 200);
	assert.equal(repeatedReceipt.data.replayed, true);
	assert.equal(repeatedReceipt.data.product.stock, 12);

	const reusedKey = await send(context.baseUrl, `/api/products/${product.id}/movements`, {
		method: "POST",
		headers: { "Idempotency-Key": key },
		body: { type: "receive", quantity: 13, note: "Different request" }
	});
	assert.equal(reusedKey.response.status, 409);
	assert.equal(reusedKey.data.error.code, "IDEMPOTENCY_KEY_REUSED");

	const removal = await send(context.baseUrl, `/api/products/${product.id}/movements`, {
		method: "POST",
		body: { type: "remove", quantity: 5, note: "Order fulfillment" }
	});
	assert.equal(removal.response.status, 201);
	assert.equal(removal.data.product.stock, 7);

	const readBack = await send(context.baseUrl, `/api/products/${product.id}`);
	assert.equal(readBack.response.status, 200);
	assert.equal(readBack.data.product.stock, 7);

	const history = await send(context.baseUrl, `/api/products/${product.id}/movements`);
	assert.deepEqual(history.data.movements.map(({ type, quantity }) => [type, quantity]), [
		["receive", 12],
		["remove", 5]
	]);
	const removals = await send(context.baseUrl, "/api/movements?type=remove");
	assert.equal(removals.data.movements.length, 1);
	assert.equal(removals.data.movements[0].sku, product.sku);
	const invalidFilter = await send(context.baseUrl, "/api/movements?type=ship");
	assert.equal(invalidFilter.response.status, 400);

	await context.close();
	const restartedDatabase = createDatabase(context.databasePath, { seed: false });
	const restartedServer = createServer(createApiApp(restartedDatabase));
	restartedServer.listen(0, "127.0.0.1");
	await once(restartedServer, "listening");
	try {
		const restartedUrl = `http://127.0.0.1:${restartedServer.address().port}`;
		const persisted = await send(restartedUrl, `/api/products/${product.id}`);
		assert.equal(persisted.response.status, 200);
		assert.equal(persisted.data.product.stock, 7);
	} finally {
		const closedServer = new Promise((resolve, reject) => {
			restartedServer.close((error) => error ? reject(error) : resolve());
		});
		restartedServer.closeAllConnections();
		await closedServer;
		restartedDatabase.close();
	}
});

test("invalid movements and unknown products leave stock and history unchanged", async (t) => {
	const { baseUrl } = await startTestServer(t);
	const product = await createTestProduct(baseUrl);

	const receipt = await send(baseUrl, `/api/products/${product.id}/movements`, {
		method: "POST",
		body: { type: "receive", quantity: 3 }
	});
	assert.equal(receipt.data.product.stock, 3);

	const invalidCases = [
		{ type: "remove", quantity: 0 },
		{ type: "remove", quantity: -1 },
		{ type: "remove", quantity: 1.5 },
		{ type: "remove", quantity: "2" },
		{ type: "ship", quantity: 1 },
		{ type: "remove" }
	];
	for (const body of invalidCases) {
		const result = await send(baseUrl, `/api/products/${product.id}/movements`, { method: "POST", body });
		assert.equal(result.response.status, 400);
		assert.equal(result.data.error.code, "INVALID_MOVEMENT");
	}

	const tooMuch = await send(baseUrl, `/api/products/${product.id}/movements`, {
		method: "POST",
		body: { type: "remove", quantity: 4 }
	});
	assert.equal(tooMuch.response.status, 409);
	assert.equal(tooMuch.data.error.code, "INSUFFICIENT_STOCK");
	assert.equal(tooMuch.data.error.details.available, 3);

	const unknown = await send(baseUrl, "/api/products/999999");
	assert.equal(unknown.response.status, 404);
	assert.equal(unknown.data.error.code, "PRODUCT_NOT_FOUND");
	const unknownMovement = await send(baseUrl, "/api/products/999999/movements", {
		method: "POST",
		body: { type: "receive", quantity: 1 }
	});
	assert.equal(unknownMovement.response.status, 404);

	const productAfterFailures = await send(baseUrl, `/api/products/${product.id}`);
	assert.equal(productAfterFailures.data.product.stock, 3);
	const historyAfterFailures = await send(baseUrl, `/api/products/${product.id}/movements`);
	assert.equal(historyAfterFailures.data.movements.length, 1);
});

test("seeded sample stock has matching receipt history", async (t) => {
	const { baseUrl } = await startTestServer(t, undefined, true);
	const response = await send(baseUrl, "/api/products");
	assert.equal(response.data.products.length, 6);

	for (const product of response.data.products) {
		const history = await send(baseUrl, `/api/products/${product.id}/movements`);
		const reconstructed = history.data.movements.reduce((stock, movement) => (
			stock + (movement.type === "receive" ? movement.quantity : -movement.quantity)
		), 0);
		assert.equal(reconstructed, product.stock);
	}
});
