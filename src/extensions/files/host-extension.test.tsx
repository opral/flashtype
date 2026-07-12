import { act } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vitest";
import type { AtelierExtensionRuntime } from "@opral/atelier";
import type { ExtensionContext } from "@/extension-runtime/types";

const filesViewMock = vi.hoisted(() =>
	vi.fn((_props: Record<string, unknown>) => null),
);
const executeTakeFirstMock = vi.hoisted(() => vi.fn());
const qbMock = vi.hoisted(() => vi.fn());

vi.mock("./index", () => ({ FilesView: filesViewMock }));
vi.mock("@/lib/lix-kysely", () => ({ qb: qbMock }));

import { createFilesExtensionRegistration } from "./host-extension";

describe("createFilesExtensionRegistration", () => {
	afterEach(() => {
		document.body.replaceChildren();
		vi.clearAllMocks();
	});

	test("imports watched files before opening them through Atelier documents", async () => {
		const query = {
			selectFrom: vi.fn(),
			select: vi.fn(),
			where: vi.fn(),
			executeTakeFirst: executeTakeFirstMock,
		};
		query.selectFrom.mockReturnValue(query);
		query.select.mockReturnValue(query);
		query.where.mockReturnValue(query);
		qbMock.mockReturnValue(query);
		executeTakeFirstMock
			.mockResolvedValueOnce(undefined)
			.mockResolvedValueOnce({ id: "imported-file" });

		const importFilesystemPaths = vi.fn().mockResolvedValue(undefined);
		const open = vi.fn().mockResolvedValue(undefined);
		const closeActive = vi.fn().mockResolvedValue(undefined);
		const atelier = {
			lix: { importFilesystemPaths },
			documents: { open, closeActive },
			revisions: {
				current: { branchId: "checkpoint-1" },
				show: vi.fn(),
				clear: vi.fn(),
			},
		} as unknown as AtelierExtensionRuntime;
		const registration = createFilesExtensionRegistration({
			ephemeral: true,
			path: "/workspace",
			name: "workspace",
			openFilePaths: [],
		});
		const element = document.createElement("div");
		document.body.append(element);

		let mounted: ReturnType<typeof registration.entry.mount>;
		await act(async () => {
			mounted = registration.entry.mount({
				element,
				atelier,
				view: {
					instanceId: "files-1",
					state: {},
					panel: "left",
					isActive: true,
					isFocused: true,
					registerNewFileDraftHandler: () => () => {},
				},
				signal: new AbortController().signal,
			});
		});

		expect(registration.manifest.id).toBe("atelier_files");
		expect("runtime" in registration).toBe(false);
		const context = filesViewMock.mock.calls.at(-1)?.[0]
			.context as ExtensionContext;
		expect(context.checkpointBranchId).toBe("checkpoint-1");
		await context.openFile?.({
			panel: "central",
			fileId: "watched:/docs/note.md",
			filePath: "/docs/note.md",
		});

		expect(importFilesystemPaths).toHaveBeenCalledWith(["docs/note.md"]);
		expect(open).toHaveBeenCalledWith("/docs/note.md", {});
		context.closeFileViews?.({ fileId: "imported-file" });
		expect(closeActive).toHaveBeenCalledOnce();

		await act(async () => {
			mounted?.dispose?.();
		});
	});
});
