import React, { useEffect, useMemo, useRef, useState } from "react";
import { createProduct, createStockMovement, fetchMovements, fetchProducts } from "./api/products.js";
import ProductFormDialog from "./components/ProductFormDialog.jsx";
import ProductTable from "./components/ProductTable.jsx";
import StockMovementDialog from "./components/StockMovementDialog.jsx";
import WorkspacePages from "./components/WorkspacePages.jsx";

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });
const navigation = [
	{ id: "overview", label: "Overview", icon: "▦" },
	{ id: "inventory", label: "Inventory", icon: "▤" },
	{ id: "orders", label: "Orders", icon: "↗" },
	{ id: "reports", label: "Reports", icon: "▥" }
];
const pageDetails = {
	overview: { title: "Overview", subtitle: "A quick look at stock health and recent activity." },
	inventory: { title: "Inventory", subtitle: "Manage products and record every stock change." },
	orders: { title: "Orders", subtitle: "Fulfill orders by recording stock leaving inventory." },
	reports: { title: "Reports", subtitle: "Review stock levels and movement history." }
};

function getPageFromHash() {
	const page = window.location.hash.slice(1);
	return pageDetails[page] ? page : "overview";
}

function formatCategory(category) {
	return category
		.split("-")
		.map((word) => word.charAt(0).toUpperCase() + word.slice(1))
		.join(" ");
}

function downloadCsv(filename, rows) {
	const csv = rows
		.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
		.join("\n");
	const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
}

function exportProducts(products) {
	downloadCsv("stockroom-inventory.csv", [
		["Product", "SKU", "Category", "Price", "Stock", "Low-stock threshold"],
		...products.map((product) => [
			product.title,
			product.sku,
			product.category,
			product.price,
			product.stock,
			product.lowStockThreshold
		])
	]);
}

function exportMovements(movements) {
	downloadCsv("stockroom-movements.csv", [
		["Movement", "Product", "SKU", "Quantity", "Note", "Date"],
		...movements.map((movement) => [
			movement.type,
			movement.title,
			movement.sku,
			movement.type === "receive" ? movement.quantity : -movement.quantity,
			movement.note,
			movement.createdAt
		])
	]);
}

export default function App() {
	const [products, setProducts] = useState([]);
	const [movements, setMovements] = useState([]);
	const [loading, setLoading] = useState(true);
	const [movementsLoading, setMovementsLoading] = useState(true);
	const [loadError, setLoadError] = useState("");
	const [movementsError, setMovementsError] = useState("");
	const [currentPage, setCurrentPage] = useState(getPageFromHash);
	const [search, setSearch] = useState("");
	const [category, setCategory] = useState("all");
	const [productDialogOpen, setProductDialogOpen] = useState(false);
	const [selectedProduct, setSelectedProduct] = useState(null);
	const [movementDefaults, setMovementDefaults] = useState({ type: "receive", note: "" });
	const [savingProduct, setSavingProduct] = useState(false);
	const [savingMovement, setSavingMovement] = useState(false);
	const [formError, setFormError] = useState("");
	const [movementError, setMovementError] = useState("");
	const [statusMessage, setStatusMessage] = useState("");
	const createInFlight = useRef(false);
	const movementInFlight = useRef(false);

	async function loadProducts(signal) {
		setLoading(true);
		setLoadError("");
		try {
			setProducts(await fetchProducts(signal));
		} catch (error) {
			if (error.name !== "AbortError") {
				setLoadError(error instanceof Error ? error.message : "Could not load products.");
			}
		} finally {
			if (!signal?.aborted) setLoading(false);
		}
	}

	async function loadMovements(signal) {
		setMovementsLoading(true);
		setMovementsError("");
		try {
			setMovements(await fetchMovements(signal));
		} catch (error) {
			if (error.name !== "AbortError") {
				setMovementsError(error instanceof Error ? error.message : "Could not load stock activity.");
			}
		} finally {
			if (!signal?.aborted) setMovementsLoading(false);
		}
	}

	useEffect(() => {
		const controller = new AbortController();
		loadProducts(controller.signal);
		loadMovements(controller.signal);
		const updatePage = () => setCurrentPage(getPageFromHash());
		window.addEventListener("hashchange", updatePage);
		return () => {
			controller.abort();
			window.removeEventListener("hashchange", updatePage);
		};
	}, []);

	const categories = useMemo(
		() => [...new Set(products.map((product) => product.category))].sort(),
		[products]
	);
	const filteredProducts = useMemo(() => {
		const query = search.trim().toLowerCase();
		return products.filter((product) => {
			const matchesQuery = `${product.title} ${product.sku} ${product.category}`.toLowerCase().includes(query);
			return matchesQuery && (category === "all" || product.category === category);
		});
	}, [products, search, category]);

	const totalUnits = products.reduce((sum, product) => sum + product.stock, 0);
	const lowStockCount = products.filter((product) => product.stock <= product.lowStockThreshold).length;
	const inventoryValue = products.reduce((sum, product) => sum + product.price * product.stock, 0);

	async function handleCreateProduct(product) {
		if (createInFlight.current) return;
		createInFlight.current = true;
		setSavingProduct(true);
		setFormError("");
		setStatusMessage("");
		try {
			const created = await createProduct(product);
			setProducts((current) => [...current, created]);
			setCategory("all");
			setSearch("");
			setProductDialogOpen(false);
			setStatusMessage(`${created.title} was created with 0 stock. Record a receipt to add units.`);
		} catch (error) {
			setFormError(error instanceof Error ? error.message : "Could not create this product.");
		} finally {
			createInFlight.current = false;
			setSavingProduct(false);
		}
	}

	async function handleStockMovement(movement, idempotencyKey) {
		if (!selectedProduct || movementInFlight.current) return;
		movementInFlight.current = true;
		setSavingMovement(true);
		setMovementError("");
		setStatusMessage("");
		try {
			const result = await createStockMovement(selectedProduct.id, movement, idempotencyKey);
			setProducts((current) => current.map((product) => (
				product.id === result.product.id ? result.product : product
			)));
			setMovements((current) => [
				{ ...result.movement, title: result.product.title, sku: result.product.sku },
				...current.filter((item) => item.id !== result.movement.id)
			]);
			setSelectedProduct(null);
			const action = movement.type === "receive" ? "Received" : "Removed";
			setStatusMessage(`${action} ${movement.quantity} units ${movement.type === "receive" ? "into" : "from"} ${result.product.title}.`);
		} catch (error) {
			setMovementError(error instanceof Error ? error.message : "Could not record this stock movement.");
			if (Number.isSafeInteger(error.details?.available)) {
				const currentStock = error.details.available;
				setProducts((current) => current.map((product) => (
					product.id === selectedProduct.id ? { ...product, stock: currentStock } : product
				)));
				setSelectedProduct((product) => product ? { ...product, stock: currentStock } : product);
			}
		} finally {
			movementInFlight.current = false;
			setSavingMovement(false);
		}
	}

	function openProductDialog() {
		setFormError("");
		setStatusMessage("");
		setProductDialogOpen(true);
	}

	function openStockDialog(product, type = "receive", note = "") {
		setMovementError("");
		setStatusMessage("");
		setMovementDefaults({ type, note });
		setSelectedProduct(product);
	}

	const page = pageDetails[currentPage];

	return (
		<div className="layout">
			<aside className="sidebar" aria-label="Main navigation">
				<div className="brand">
					<div className="brand-mark" aria-hidden="true">s</div>
					<div className="brand-name">stockroom</div>
				</div>
				<div className="eyebrow nav-label">Workspace</div>
				<nav className="nav">
					{navigation.map((item) => (
						<a
							className={`nav-link ${currentPage === item.id ? "active" : ""}`}
							href={`#${item.id}`}
							aria-current={currentPage === item.id ? "page" : undefined}
							key={item.id}
						>
							<span className="nav-icon" aria-hidden="true">{item.icon}</span>
							<span className="nav-text">{item.label}</span>
							{item.id === "inventory" && <span className="nav-count">{products.length}</span>}
						</a>
					))}
				</nav>
				<div className="sidebar-bottom">
					<div className="help-card">
						<strong>Stock history</strong>
						<p>Every receipt and removal is stored as a dated movement.</p>
						<a href="#reports">Open reports →</a>
					</div>
					<div className="user-card">
						<div className="avatar" aria-hidden="true">JD</div>
						<div><div className="user-name">Jamie Davis</div><div className="user-role">Store manager</div></div>
					</div>
				</div>
			</aside>

			<main id={currentPage}>
				<header className="topbar">
					<div className="breadcrumb">Workspace <span>/</span> {page.title}</div>
					<div className="top-actions">
						<button className="icon-button" type="button" aria-label="Notifications">♧<span className="notification-dot" /></button>
						<div className="avatar" aria-label="Jamie Davis">JD</div>
					</div>
				</header>

				<section className="page-heading" aria-labelledby="page-title">
					<div>
						<h1 id="page-title">{page.title}</h1>
						<p className="subtitle">{page.subtitle}</p>
					</div>
					{(currentPage === "overview" || currentPage === "inventory") && (
						<button className="primary-button" type="button" onClick={openProductDialog} disabled={loading || Boolean(loadError)}>
							<span aria-hidden="true">＋</span> Add product
						</button>
					)}
				</section>

				{loadError && (
					<div className="error-banner" role="alert">
						<span>{loadError}</span>
						<button className="secondary-button" type="button" onClick={() => loadProducts()}>Try again</button>
					</div>
				)}
				{statusMessage && (
					<div className="success-banner" role="status">
						<span>{statusMessage}</span>
						<button type="button" onClick={() => setStatusMessage("")} aria-label="Dismiss message">×</button>
					</div>
				)}

				{(currentPage === "overview" || currentPage === "inventory") && (
					<section className="metrics" aria-label="Inventory summary">
						<article className="metric">
							<div className="metric-top"><span>Total products</span><span className="metric-icon" aria-hidden="true">▤</span></div>
							<div className="metric-value">{loading ? "—" : products.length}</div>
							<div className="metric-note">Stored products</div>
						</article>
						<article className="metric">
							<div className="metric-top"><span>Total stock units</span><span className="metric-icon" aria-hidden="true">▦</span></div>
							<div className="metric-value">{loading ? "—" : totalUnits.toLocaleString()}</div>
							<div className="metric-note">Across listed products</div>
						</article>
						<article className="metric">
							<div className="metric-top"><span>Low stock</span><span className="metric-icon" aria-hidden="true">⌁</span></div>
							<div className="metric-value">{loading ? "—" : lowStockCount}</div>
							<div className="metric-note">At or below each product's alert level</div>
						</article>
						<article className="metric">
							<div className="metric-top"><span>Inventory value</span><span className="metric-icon" aria-hidden="true">$</span></div>
							<div className="metric-value">{loading ? "—" : currency.format(inventoryValue)}</div>
							<div className="metric-note">Price × current stock</div>
						</article>
					</section>
				)}

				{currentPage === "inventory" ? (
					<section className="inventory-panel" aria-labelledby="inventory-title">
						<div className="panel-heading">
							<h2 id="inventory-title">Products <span className="product-count">{loading ? "Loading…" : `${filteredProducts.length} shown`}</span></h2>
							<button className="export-button" type="button" onClick={() => exportProducts(products)} disabled={loading || products.length === 0}>↓ &nbsp;Export</button>
						</div>
						<div className="filters">
							<label className="search-wrap">
								<span className="search-icon" aria-hidden="true">⌕</span>
								<input className="search-input" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." aria-label="Search products" />
							</label>
							<label>
								<span className="visually-hidden">Filter by category</span>
								<select className="category-select" value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by category" disabled={loading}>
									<option value="all">All categories</option>
									{categories.map((value) => <option key={value} value={value}>{formatCategory(value)}</option>)}
								</select>
							</label>
						</div>
						<ProductTable products={filteredProducts} loading={loading} onManageStock={openStockDialog} />
						<footer className="table-footer">
							<span>{loading ? "Loading products…" : `Showing ${filteredProducts.length} of ${products.length} products`}</span>
							<span className="demo-note">API data · SQLite-backed</span>
						</footer>
					</section>
				) : currentPage === "overview" ? (
					<WorkspacePages
						page={currentPage}
						products={products}
						movements={movements}
						movementsLoading={movementsLoading}
						movementsError={movementsError}
						onRetry={() => loadMovements()}
						onManageStock={openStockDialog}
					/>
				) : (
					<WorkspacePages
						page={currentPage}
						products={products}
						movements={movements}
						movementsLoading={movementsLoading}
						movementsError={movementsError}
						onRetry={() => loadMovements()}
						onFulfill={(product) => openStockDialog(product, "remove", "Order fulfillment")}
						onExport={exportMovements}
					/>
				)}
			</main>

			<ProductFormDialog
				open={productDialogOpen}
				categories={categories.length ? categories : ["General"]}
				saving={savingProduct}
				error={formError}
				onClose={() => setProductDialogOpen(false)}
				onSubmit={handleCreateProduct}
			/>
			<StockMovementDialog
				product={selectedProduct}
				saving={savingMovement}
				error={movementError}
				initialType={movementDefaults.type}
				initialNote={movementDefaults.note}
				onClose={() => setSelectedProduct(null)}
				onSubmit={handleStockMovement}
			/>
		</div>
	);
}
