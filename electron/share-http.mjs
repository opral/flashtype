/** Bound token validation and ordinary API calls, including reading their response bodies. */
export function withRequestTimeout(fetcher, timeoutMs = 10_000) {
	return (input, init = {}) => {
		const signals = [AbortSignal.timeout(timeoutMs)];
		if (input instanceof Request) signals.push(input.signal);
		if (init.signal) signals.push(init.signal);
		return fetcher(input, { ...init, signal: AbortSignal.any(signals) });
	};
}
/** Sync streams may remain open; only bound time to the first response headers. */
export async function fetchSync(input, init = {}) {
	const controller = new AbortController();
	const signals = [controller.signal];
	if (input instanceof Request) signals.push(input.signal);
	if (init.signal) signals.push(init.signal);
	const timer = setTimeout(() => controller.abort(), 10_000);
	try {
		return await fetch(input, { ...init, signal: AbortSignal.any(signals) });
	} finally {
		clearTimeout(timer);
	}
}
export async function readSharingJson(response) {
	const reader = response.body?.getReader();
	if (!reader) return {};
	const chunks = [];
	let size = 0;
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.length;
			if (size > 64 * 1024)
				throw new Error("Lixray returned an oversized sharing response.");
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
	const bytes = Buffer.concat(chunks);
	try {
		return bytes.length ? JSON.parse(bytes.toString()) : {};
	} catch {
		throw new Error("Lixray sharing is unavailable. Please try again.");
	}
}
