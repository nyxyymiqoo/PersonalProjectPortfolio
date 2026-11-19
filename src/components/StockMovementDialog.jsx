import React, { useEffect, useRef } from "react";

export default function StockMovementDialog({
	product,
	saving,
	error,
	initialType = "receive",
	initialNote = "",
	onClose,
	onSubmit
}) {
	const dialogRef = useRef(null);
	const formRef = useRef(null);
	const requestKeyRef = useRef(null);

	useEffect(() => {
		const dialog = dialogRef.current;
		if (dialog && product && !dialog.open) {
			formRef.current?.reset();
			const typeField = formRef.current?.elements.namedItem("type");
			const noteField = formRef.current?.elements.namedItem("note");
			if (typeField) typeField.value = initialType;
			if (noteField) noteField.value = initialNote;
			requestKeyRef.current = crypto.randomUUID();
			dialog.showModal();
		} else if (dialog && !product && dialog.open) {
			dialog.close();
		}
	}, [initialNote, initialType, product]);

	function handleSubmit(event) {
		event.preventDefault();
		const formData = new FormData(event.currentTarget);
		onSubmit({
			type: String(formData.get("type")),
			quantity: Number(formData.get("quantity")),
			note: String(formData.get("note")).trim()
		}, requestKeyRef.current);
	}

	return (
		<dialog
			ref={dialogRef}
			aria-labelledby="movement-dialog-title"
			onClose={onClose}
			onClick={(event) => {
				if (event.target === dialogRef.current) onClose();
			}}
		>
			{product && (
				<form ref={formRef} className="dialog-content" onSubmit={handleSubmit}>
					<div className="dialog-header">
						<div>
							<h2 id="movement-dialog-title">Manage stock</h2>
							<p className="dialog-subtitle">{product.title} · {product.stock} currently in stock</p>
						</div>
						<button className="close-button" type="button" onClick={onClose} aria-label="Close dialog">×</button>
					</div>
					<div className="form-grid">
						<div className="form-field">
							<label htmlFor="movement-type">Movement</label>
							<select id="movement-type" name="type" required>
								<option value="receive">Receive stock</option>
								<option value="remove">Remove stock</option>
							</select>
						</div>
						<div className="form-field">
							<label htmlFor="movement-quantity">Quantity</label>
							<input id="movement-quantity" name="quantity" type="number" min="1" max="1000000" step="1" required placeholder="e.g. 12" />
						</div>
						<div className="form-field wide">
							<label htmlFor="movement-note">Note (optional)</label>
							<input id="movement-note" name="note" maxLength="500" placeholder="e.g. Supplier delivery or damaged item" />
						</div>
					</div>
					{error && <p className="form-error" role="alert">{error}</p>}
					<div className="dialog-actions">
						<button className="secondary-button" type="button" onClick={onClose}>Cancel</button>
						<button className="primary-button" type="submit" disabled={saving}>
							{saving ? "Saving…" : "Record movement"}
						</button>
					</div>
				</form>
			)}
		</dialog>
	);
}
