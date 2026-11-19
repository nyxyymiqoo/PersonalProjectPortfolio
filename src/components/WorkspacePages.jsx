import React, { useMemo, useState } from "react";

function formatDate(value) {
	return new Date(value).toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		year: "numeric",
		hour: "numeric",
		minute: "2-digit"
	});
}

function MovementTable({ movements, loading, error, onRetry, emptyMessage, compact = false }) {
	if (loading) return <div className="table-message" role="status">Loading stock activity…</div>;
	if (error) {
		return (
			<div className="page-error" role="alert">
				<span>{error}</span>
				<button className="secondary-button" type="button" onClick={onRetry}>Try again</button>
			</div>
		);
	}
	if (movements.length === 0) return <div className="table-message">{emptyMessage}</div>;

	return (
		<div className="table-scroll">
			<table>
				<thead>
					<tr>
						<th scope="col">Movement</th>
						<th scope="col">Product</th>
						<th scope="col">Quantity</th>
						{!compact && <th scope="col">Note</th>}
						<th scope="col">{compact ? "When" : "Recorded"}</th>
					</tr>
				</thead>
				<tbody>
					{movements.map((movement) => (
						<tr key={movement.id}>
							<td><span className={`movement-type ${movement.type}`}>{movement.type === "receive" ? "Received" : "Removed"}</span></td>
							<td>
								<div className="product-name">{movement.title}</div>
								<div className="product-sku">{movement.sku}</div>
							</td>
							<td className="movement-quantity">{movement.type === "receive" ? "+" : "−"}{movement.quantity}</td>
							{!compact && <td className="movement-note">{movement.note || "—"}</td>}
							<td className="movement-date">{formatDate(movement.createdAt)}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
}

function OverviewPage({ products, movements, movementsLoading, movementsError, onRetry, onManageStock }) {
	const restockProducts = products.filter((product) => product.stock <= product.lowStockThreshold);

	return (
		<div className="workspace-grid">
			<section className="content-panel" aria-labelledby="restock-title">
				<div className="panel-heading">
					<div>
						<h2 id="restock-title">Needs attention</h2>
						<p className="panel-description">Products at or below their low-stock alert.</p>
					</div>
					<span className="panel-badge">{restockProducts.length}</span>
				</div>
				{restockProducts.length === 0 ? (
					<div className="table-message">Everything is above its low-stock alert.</div>
				) : (
					<div className="attention-list">
						{restockProducts.map((product) => (
							<div className="attention-row" key={product.id}>
								<div>
									<div className="product-name">{product.title}</div>
									<div className="product-sku">{product.sku} · alert at {product.lowStockThreshold}</div>
								</div>
								<div className="attention-stock">{product.stock} left</div>
								<button className="table-action" type="button" onClick={() => onManageStock(product)}>Manage stock</button>
							</div>
						))}
					</div>
				)}
			</section>

			<section className="content-panel" aria-labelledby="recent-activity-title">
				<div className="panel-heading">
					<div>
						<h2 id="recent-activity-title">Recent stock activity</h2>
						<p className="panel-description">The latest receipts and removals.</p>
					</div>
					<a className="text-link" href="#reports">View report →</a>
				</div>
				<MovementTable
					movements={movements.slice(0, 5)}
					loading={movementsLoading}
					error={movementsError}
					onRetry={onRetry}
					emptyMessage="No stock movements have been recorded yet."
					compact
				/>
			</section>
		</div>
	);
}

function OrdersPage({ products, movements, movementsLoading, movementsError, onRetry, onFulfill }) {
	const [productId, setProductId] = useState("");
	const availableProducts = products.filter((product) => product.stock > 0);
	const selectedProduct = availableProducts.find((product) => String(product.id) === productId) || availableProducts[0];
	const fulfillments = movements.filter((movement) => movement.type === "remove");

	return (
		<div className="page-stack">
			<section className="content-panel" aria-labelledby="fulfillment-title">
				<div className="panel-heading">
					<div>
						<h2 id="fulfillment-title">Record an order fulfillment</h2>
						<p className="panel-description">Choose an item, then record the quantity leaving stock.</p>
					</div>
				</div>
				<div className="fulfillment-form">
					<label className="form-field">
						<span>Product</span>
						<select
							value={selectedProduct ? String(selectedProduct.id) : ""}
							onChange={(event) => setProductId(event.target.value)}
							disabled={availableProducts.length === 0}
						>
							{availableProducts.length === 0
								? <option value="">No products with available stock</option>
								: availableProducts.map((product) => (
									<option key={product.id} value={product.id}>{product.title} · {product.stock} available</option>
								))}
						</select>
					</label>
					<button className="primary-button" type="button" disabled={!selectedProduct} onClick={() => onFulfill(selectedProduct)}>
						Record fulfillment
					</button>
				</div>
				{availableProducts.length === 0 && <p className="form-hint">Receive stock before a product can be fulfilled.</p>}
			</section>

			<section className="content-panel" aria-labelledby="orders-history-title">
				<div className="panel-heading">
					<div>
						<h2 id="orders-history-title">Fulfillment history</h2>
						<p className="panel-description">Recorded order fulfillments are stock-removal movements.</p>
					</div>
					<span className="panel-badge">{fulfillments.length}</span>
				</div>
				<MovementTable
					movements={fulfillments}
					loading={movementsLoading}
					error={movementsError}
					onRetry={onRetry}
					emptyMessage="No fulfillments recorded yet. Recording one above will add it here."
				/>
			</section>
		</div>
	);
}

function ReportsPage({ products, movements, movementsLoading, movementsError, onRetry, onExport }) {
	const categorySummary = useMemo(() => {
		const summary = new Map();
		for (const product of products) {
			const current = summary.get(product.category) || { category: product.category, products: 0, stock: 0, value: 0 };
			current.products += 1;
			current.stock += product.stock;
			current.value += product.price * product.stock;
			summary.set(product.category, current);
		}
		return [...summary.values()].sort((first, second) => first.category.localeCompare(second.category));
	}, [products]);

	const received = movements.filter((movement) => movement.type === "receive").reduce((sum, movement) => sum + movement.quantity, 0);
	const removed = movements.filter((movement) => movement.type === "remove").reduce((sum, movement) => sum + movement.quantity, 0);

	return (
		<div className="page-stack">
			<section className="report-stats" aria-label="Stock movement totals">
				<article className="report-stat"><span>Units received</span><strong>+{received.toLocaleString()}</strong></article>
				<article className="report-stat"><span>Units removed</span><strong>−{removed.toLocaleString()}</strong></article>
				<article className="report-stat"><span>Net movement</span><strong>{(received - removed).toLocaleString()}</strong></article>
			</section>

			<section className="content-panel" aria-labelledby="category-report-title">
				<div className="panel-heading">
					<div>
						<h2 id="category-report-title">Stock by category</h2>
						<p className="panel-description">Current units and estimated stock value for each category.</p>
					</div>
				</div>
				{categorySummary.length === 0 ? (
					<div className="table-message">Add products to see a category summary.</div>
				) : (
					<div className="table-scroll">
						<table>
							<thead><tr><th scope="col">Category</th><th scope="col">Products</th><th scope="col">Units in stock</th><th scope="col">Stock value</th></tr></thead>
							<tbody>
								{categorySummary.map((summary) => (
									<tr key={summary.category}>
										<td className="product-name">{summary.category}</td>
										<td>{summary.products}</td>
										<td>{summary.stock.toLocaleString()}</td>
										<td>{summary.value.toLocaleString("en-US", { style: "currency", currency: "USD" })}</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</section>

			<section className="content-panel" aria-labelledby="movement-report-title">
				<div className="panel-heading">
					<div>
						<h2 id="movement-report-title">Stock movement report</h2>
						<p className="panel-description">A dated ledger of every receipt and removal.</p>
					</div>
					<button className="export-button" type="button" onClick={() => onExport(movements)} disabled={movementsLoading || movements.length === 0}>↓ &nbsp;Export</button>
				</div>
				<MovementTable
					movements={movements}
					loading={movementsLoading}
					error={movementsError}
					onRetry={onRetry}
					emptyMessage="No stock movements to report yet."
				/>
			</section>
		</div>
	);
}

export default function WorkspacePages(props) {
	switch (props.page) {
		case "overview":
			return <OverviewPage {...props} />;
		case "orders":
			return <OrdersPage {...props} />;
		case "reports":
			return <ReportsPage {...props} />;
		default:
			return null;
	}
}
