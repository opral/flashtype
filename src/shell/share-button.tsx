import { useRef, useState } from "react";
import { Share2, X, ExternalLink, Mail, Cloud } from "lucide-react";

export function ShareButton() {
	const dialog = useRef<HTMLDialogElement>(null);
	const [error, setError] = useState("");
	async function openExternal(event: React.MouseEvent<HTMLAnchorElement>) {
		const api = window.flashtypeDesktop?.app;
		if (!api) return;
		event.preventDefault();
		setError("");
		try {
			await api.openExternal({ url: event.currentTarget.href });
		} catch {
			setError("Could not open the link. Please try again.");
		}
	}
	return (
		<>
			<button
				type="button"
				className="flashtype-share-button"
				onClick={() => {
					setError("");
					dialog.current?.showModal();
				}}
			>
				<Share2 size={14} /> Share
			</button>
			<dialog
				ref={dialog}
				className="flashtype-share-dialog"
				aria-labelledby="share-title"
				onClick={(event) => {
					if (event.target === event.currentTarget) dialog.current?.close();
				}}
				onKeyDown={(event) => {
					if (event.key === "Escape") dialog.current?.close();
				}}
			>
				<div className="share-teaser">
					<div className="share-teaser-header">
						<span className="share-teaser-icon">
							<Cloud size={24} aria-hidden="true" />
						</span>

						<button
							type="button"
							aria-label="Close sharing"
							className="share-teaser-close"
							onClick={() => dialog.current?.close()}
						>
							<X size={18} />
						</button>
					</div>
					<h2 id="share-title">Flashtype, in the cloud.</h2>
					<p className="share-teaser-description">
						Use Lixray, the cloud version of Flashtype, to publish and share
						your files.
					</p>
					<a
						className="share-teaser-primary"
						href="https://lixray.com"
						target="_blank"
						rel="noreferrer"
						onClick={openExternal}
					>
						Open lixray.com <ExternalLink size={14} />
					</a>
					<div className="share-teaser-sync">
						<h3>Interested in local sync?</h3>
						<a
							className="flashtype-share-link"
							href="mailto:samuel@opral.com?subject=Flashtype%20sync%20request&body=Hi%20Samuel%2C%0A%0AI%E2%80%99m%20interested%20in%20syncing%20my%20local%20Flashtype%20files%20with%20Lixray.%20Please%20let%20me%20know%20when%20local%20sync%20is%20available.%0A%0AThanks%21"
							onClick={openExternal}
						>
							<Mail size={14} /> Write an email to samuel@opral.com
						</a>
					</div>
					{error && (
						<p role="alert" className="mt-4 text-sm text-red-600">
							{error}
						</p>
					)}
				</div>
			</dialog>
		</>
	);
}
