import { createFileRoute } from "@tanstack/react-router";
import { DownloadHandoffPage } from "../../download-handoff-page";

export const Route = createFileRoute("/download/")({
	component: DownloadPage,
});

function DownloadPage() {
	return <DownloadHandoffPage title="Starting your download" />;
}
