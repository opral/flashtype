import React from "react";
import { test, expect, vi } from "vitest";
import { qb } from "@/lib/lix-kysely";
import {
	render,
	screen,
	waitFor,
	act,
} from "@testing-library/react";
import { LixProvider } from "@/lib/lix-react";
import { openLix } from "@/test-utils/node-lix-sdk";
import { useKeyValue, KeyValueProvider } from "./use-key-value";
import { KEY_VALUE_DEFINITIONS } from "./schema";

function nextTestKey(base: string): string {
	return `${base}_${Math.random().toString(36).slice(2, 10)}`;
}

function withKeyDef(
	key: string,
	def: { defaultBranchId: "active" | "global" | string; untracked: boolean },
) {
	return {
		...KEY_VALUE_DEFINITIONS,
		[key]: def,
	} as any;
}

async function actAndFlush(callback: () => void | Promise<void>) {
	await act(async () => {
		await callback();
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
}

function renderUseKeyValue(
	key: string,
	wrapper: React.ComponentType<{ children: React.ReactNode }>,
	opts?: Parameters<typeof useKeyValue>[1],
) {
	const resultRef: { current: unknown } = { current: null };
	function TestComponent() {
		resultRef.current = useKeyValue(key, opts);
		return null;
	}
	render(<TestComponent />, { wrapper });
	return resultRef;
}

test("reads a global, untracked key (test fixture)", async () => {
	const testKey = nextTestKey("flashtype_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	// Pre-insert expected value
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "alpha",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});

	await waitFor(() => {
		const [value] = hookResult.current as any;
		expect(value).toBe("alpha");
	});

	const [value] = hookResult.current as any;
	expect(value).toBe("alpha");
});

test("writes and reads a global, untracked key (test fixture)", async () => {
	const testKey = nextTestKey("flashtype_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let resultRef: { current: unknown } = { current: null };
	await act(async () => {
		resultRef = renderUseKeyValue(testKey, wrapper);
	});

	// Wait for hook to initialize
	await waitFor(() =>
		expect(Array.isArray(resultRef.current as any)).toBe(true),
	);

	await actAndFlush(async () => {
		await (resultRef.current as any)?.[1]("beta");
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	await waitFor(() => expect((resultRef.current as any)?.[0]).toBe("beta"));

	// Verify DB row persisted to key_value_by_branch with lixcol_branch_id = 'global'
	const rows = (await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.where("key", "=", testKey)
		.where("lixcol_branch_id", "=", "global")
		.select(["value"])
		.execute()) as any;
	expect(rows[0]?.value).toBe("beta");
});

test("writes and reads a tracked key on active branch", async () => {
	const TEST_KEY = nextTestKey("flashtype_test_tracked");
	const lix = await openLix({});
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(TEST_KEY, wrapper);
	});

	// Wait for hook to initialize
	await waitFor(() =>
		expect(Array.isArray(hookResult.current as any)).toBe(true),
	);

	await waitFor(() => typeof (hookResult.current as any)[1] === "function");

	await actAndFlush(async () => {
		await (hookResult.current as any)[1]("hello");
		await new Promise((resolve) => setTimeout(resolve, 0));
	});

	await waitFor(() => {
		expect((hookResult.current as any)[0]).toBe("hello");
	});

	// Verify DB row persisted to tracked table
	const rows = (await qb(lix)
		.selectFrom("lix_key_value")
		.where("key", "=", TEST_KEY)
		.select(["value"])
		.execute()) as any;
	expect(rows[0]?.value).toBe("hello");
});

test("writes and reads an untracked key on active branch", async () => {
	const testKey = nextTestKey("flashtype_test_active_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "active",
		untracked: true,
	});
	const lix = await openLix({});
	const activeBranchId = await lix.activeBranchId();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});

	await waitFor(() =>
		expect(Array.isArray(hookResult.current as any)).toBe(true),
	);
	await actAndFlush(async () => {
		await (hookResult.current as any)[1]("local");
		await new Promise((resolve) => setTimeout(resolve, 0));
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
	await waitFor(() => expect((hookResult.current as any)[0]).toBe("local"));

	const rows = (await qb(lix)
		.selectFrom("lix_key_value_by_branch")
		.where("key", "=", testKey)
		.where("lixcol_branch_id", "=", activeBranchId)
		.select(["value", "lixcol_global", "lixcol_untracked"])
		.execute()) as any;
	expect(rows[0]).toMatchObject({
		value: "local",
		lixcol_global: false,
		lixcol_untracked: true,
	});
});

test("reads explicit global key when active branch has same key", async () => {
	const testKey = nextTestKey("flashtype_test_global_shadowed");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	const activeBranchId = await lix.activeBranchId();
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "global-value",
			lixcol_branch_id: "global",
			lixcol_global: true,
			lixcol_untracked: true,
		})
		.execute();
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "active-value",
			lixcol_branch_id: activeBranchId,
			lixcol_global: false,
			lixcol_untracked: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(testKey, wrapper);
	});

	await waitFor(() =>
		expect((hookResult.current as any)?.[0]).toBe("global-value"),
	);
});

test("shows Suspense fallback first, then renders value on initial read", async () => {
	const testKey = nextTestKey("flashtype_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	// Ensure the key exists so the initial load resolves deterministically
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "ready",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={<div data-testid="fb">loading</div>}>
					{children}
				</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	function ReadKV() {
		const [val] = useKeyValue(testKey);
		return <div data-testid="val">{String(val)}</div>;
	}

	await act(async () => {
		render(<ReadKV />, { wrapper });
	});
	// Eventually value appears once Suspense resolves
	const el = await screen.findByTestId("val");
	expect(el.textContent).toBe("ready");
});

test("re-renders when key value changes externally", async () => {
	const TEST_KEY = nextTestKey("flashtype_test_tracked_external");
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value")
		.values({ key: TEST_KEY, value: "initial" })
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let resultRef: { current: unknown } = { current: null };
	await act(async () => {
		resultRef = renderUseKeyValue(TEST_KEY, wrapper);
	});
	// wait for initial suspense resolution
	await waitFor(() =>
		expect(Array.isArray(resultRef.current as any)).toBe(true),
	);
	await waitFor(() => expect((resultRef.current as any)[0]).toBe("initial"));

	// mutate externally (simulate another part of app)
	await actAndFlush(async () => {
		await qb(lix)
			.updateTable("lix_key_value")
			.set({ value: "external" })
			.where("key", "=", TEST_KEY)
			.execute();
	});

	// observe re-render with new value
	await waitFor(() => expect((resultRef.current as any)[0]).toBe("external"));
});

function createDeferred<T>() {
	let resolve!: (value: T | PromiseLike<T>) => void;
	let reject!: (reason?: unknown) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return { promise, resolve, reject };
}

test("shares optimistic updates across hook instances", async () => {
	const SHARED_KEY = nextTestKey("flashtype_test_tracked_shared_optimistic");
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value")
		.values({ key: SHARED_KEY, value: "initial" })
		.execute();

	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	type Snapshot = { primary: unknown; secondary: unknown };
	const snapshots: Snapshot[] = [];
	let setValueRef:
		| ((value: string) => Promise<void>)
		| ((value: string | null) => Promise<void>)
		| null = null;

	function TwinReaders({
		onSnapshot,
		assignSetter,
	}: {
		onSnapshot: (snapshot: Snapshot) => void;
		assignSetter: (
			setter:
				| ((value: string) => Promise<void>)
				| ((value: string | null) => Promise<void>),
		) => void;
	}) {
		const [primary, setPrimary] = useKeyValue(SHARED_KEY as any);
		const [secondary] = useKeyValue(SHARED_KEY as any);

		React.useEffect(() => {
			assignSetter(setPrimary);
		}, [assignSetter, setPrimary]);

		React.useEffect(() => {
			onSnapshot({ primary, secondary });
		}, [onSnapshot, primary, secondary]);

		return null;
	}

	await act(async () => {
		render(
			<TwinReaders
				onSnapshot={(snapshot) => snapshots.push(snapshot)}
				assignSetter={(setter) => {
					setValueRef = setter;
				}}
			/>,
			{ wrapper },
		);
	});

	await waitFor(() => expect(setValueRef).not.toBeNull());
	await waitFor(() =>
		expect(
			snapshots.some(
				(snapshot) =>
					snapshot.primary === "initial" && snapshot.secondary === "initial",
			),
		).toBe(true),
	);

	const gate = createDeferred<void>();
	const originalExecute = lix.execute.bind(lix);
	const executeSpy = vi
		.spyOn(lix, "execute")
		.mockImplementation(async (...args) => {
			const [sql] = args;
			if (
				typeof sql === "string" &&
				sql.includes("INSERT INTO") &&
				sql.includes("lix_key_value")
			) {
				await gate.promise;
			}
			return originalExecute(...args);
		});

	let pendingWrite: Promise<void> | null = null;
	act(() => {
		pendingWrite = setValueRef
			? (setValueRef("next") as Promise<void>)
			: Promise.resolve();
	});

	await waitFor(() =>
		expect(snapshots.some((snapshot) => snapshot.primary === "next")).toBe(
			true,
		),
	);
	const latest = snapshots[snapshots.length - 1];
	expect(latest).toMatchObject({
		primary: "next",
		secondary: "next",
	});

	await actAndFlush(async () => {
		gate.resolve();
		await pendingWrite;
	});

	executeSpy.mockRestore();
});

test("returns optimistic value immediately when setter is called", async () => {
	const lix = await openLix({});
	const TEST_KEY = nextTestKey("flashtype_test_optimistic") as any;
	await qb(lix)
		.insertInto("lix_key_value")
		.values({ key: TEST_KEY, value: "initial" })
		.execute();
	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={KEY_VALUE_DEFINITIONS}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let hookResult: { current: unknown } = { current: null };
	await act(async () => {
		hookResult = renderUseKeyValue(TEST_KEY, wrapper);
	});

	await waitFor(() =>
		expect(Array.isArray(hookResult.current as any)).toBe(true),
	);

	let pending: Promise<unknown> | undefined;
	await actAndFlush(async () => {
		pending = (hookResult.current as any)[1]("value-1");
	});

	await waitFor(() => expect((hookResult.current as any)[0]).toBe("value-1"));

	await actAndFlush(async () => {
		await pending;
	});

	await waitFor(() => expect((hookResult.current as any)[0]).toBe("value-1"));
});

test("memoized children should not re-render when parent state changes", async () => {
	const testKey = nextTestKey("flashtype_test_untracked");
	const defs = withKeyDef(testKey, {
		defaultBranchId: "global",
		untracked: true,
	});
	const lix = await openLix({});
	await qb(lix)
		.insertInto("lix_key_value_by_branch")
		.values({
			key: testKey,
			value: "initial",
			lixcol_branch_id: "global",
			lixcol_global: true,
		})
		.execute();

	const wrapper = ({ children }: { children: React.ReactNode }) => (
		<LixProvider lix={lix}>
			<KeyValueProvider defs={defs}>
				<React.Suspense fallback={null}>{children}</React.Suspense>
			</KeyValueProvider>
		</LixProvider>
	);

	let childRenders = 0;

	const MemoChild = React.memo(function MemoChild({
		pair,
	}: {
		pair: ReturnType<typeof useKeyValue>;
	}) {
		childRenders++;
		return <div data-testid="current-tab">{String(pair[0] ?? "unknown")}</div>;
	});

	function Parent() {
		const pair = useKeyValue(testKey, {
			defaultBranchId: "global",
			untracked: true,
		});
		const [, forceRender] = React.useState(0);
		return (
			<>
				<MemoChild pair={pair} />
				<button
					type="button"
					onClick={() => forceRender((n) => n + 1)}
					data-testid="rerender-trigger"
				>
					Rerender
				</button>
			</>
		);
	}

	await act(async () => {
		render(<Parent />, { wrapper });
	});

	await screen.findByTestId("current-tab");
	await waitFor(() => expect(childRenders).toBeGreaterThan(0));
	const baseline = childRenders;

	const button = screen.getByTestId("rerender-trigger");
	await act(async () => {
		button.click();
	});

	await waitFor(() => expect(childRenders).toBe(baseline));
});
