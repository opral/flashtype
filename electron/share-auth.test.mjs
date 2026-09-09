// @vitest-environment node
import { test, expect, vi } from "vitest";
import { createShareAuth } from "./share-auth.mjs";
const token = `lixray_pat_${"a".repeat(64)}`;
const id = "86000000-0000-4000-8000-000000000001";
test("validates the pasted account token before storing it and reuses it on reopen", async () => {
	let value;
	const store = {
		getAuth: async () => value,
		setAuth: vi.fn(async (next) => {
			value = next;
		}),
	};
	const fetcher = vi.fn(async (_url, init) => {
		expect(init.headers.Authorization).toBe(`Bearer ${token}`);
		return Response.json({ id });
	});
	const auth = createShareAuth({
		store,
		origin: "https://lixray.test",
		fetcher,
	});
	expect(await auth.hasToken()).toBe(false);
	await auth.setToken(` ${token} `);
	expect(store.setAuth).toHaveBeenCalledWith({ token, accountId: id });
	const reopened = createShareAuth({
		store,
		origin: "https://lixray.test",
		fetcher,
	});
	expect(await reopened.token()).toBe(token);
	expect(await reopened.subject()).toBe(id);
	expect(await reopened.hasToken()).toBe(true);
	expect(fetcher).toHaveBeenCalledTimes(1);
});
test("invalid or revoked tokens never replace the saved credential", async () => {
	const store = { getAuth: async () => null, setAuth: vi.fn() };
	const auth = createShareAuth({
		store,
		origin: "https://lixray.test",
		fetcher: async () => new Response(null, { status: 401 }),
	});
	await expect(auth.setToken("not-a-token")).rejects.toThrow("valid Lixray");
	await expect(auth.setToken(token)).rejects.toThrow("revoked");
	expect(store.setAuth).not.toHaveBeenCalled();
});
