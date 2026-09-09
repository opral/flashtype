import { readSharingJson, withRequestTimeout } from "./share-http.mjs";

/** One account token, pasted by the user and encrypted by the host store. */
export function createShareAuth({ store, origin, fetcher = fetch }) {
	async function saved() {
		const value = await store.getAuth();
		if (!value?.token || !value?.accountId)
			throw new Error("Paste an API token from your Lixray account settings.");
		return value;
	}
	return {
		async setToken(input) {
			if (
				typeof input !== "string" ||
				!/^lixray_pat_[0-9a-f]{64}$/.test(input.trim())
			)
				throw new Error("Enter a valid Lixray API token.");
			const token = input.trim();
			const response = await withRequestTimeout(fetcher)(
				new URL("/api/account", origin),
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			);
			if (!response.ok) {
				await response.body?.cancel();
				throw new Error("This token is invalid, expired, or revoked.");
			}
			const account = await readSharingJson(response);
			if (
				typeof account.id !== "string" ||
				!/^[0-9a-f-]{36}$/i.test(account.id)
			)
				throw new Error("Lixray returned an invalid account.");
			await store.setAuth({ token, accountId: account.id });
		},
		async token() {
			return (await saved()).token;
		},
		async subject() {
			return (await saved()).accountId;
		},
		async hasToken() {
			const value = await store.getAuth();
			return Boolean(value?.token && value?.accountId);
		},
	};
}
