const textDecoder = new TextDecoder();

function hexToBytes(value: string): Uint8Array {
	const hex = value.startsWith("0x") ? value.slice(2) : value;
	if (hex.length === 0) return new Uint8Array();
	if (hex.length % 2 !== 0) return new Uint8Array();
	if (!/^[0-9a-fA-F]+$/.test(hex)) return new Uint8Array();

	const bytes = new Uint8Array(hex.length / 2);
	for (let i = 0; i < hex.length; i += 2) {
		bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
	}
	return bytes;
}

function base64ToBytes(value: string): Uint8Array {
	if (!value) return new Uint8Array();
	const maybeBuffer = (globalThis as { Buffer?: { from: Function } }).Buffer;
	if (maybeBuffer && typeof maybeBuffer.from === "function") {
		return new Uint8Array(maybeBuffer.from(value, "base64"));
	}
	if (typeof atob !== "function") {
		return new Uint8Array();
	}
	const decoded = atob(value);
	const bytes = new Uint8Array(decoded.length);
	for (let i = 0; i < decoded.length; i += 1) {
		bytes[i] = decoded.charCodeAt(i);
	}
	return bytes;
}

function decodeBlobLike(value: unknown): Uint8Array | null {
	if (value instanceof Uint8Array) return value;
	if (value instanceof ArrayBuffer) return new Uint8Array(value);
	if (ArrayBuffer.isView(value)) {
		return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
	}
	if (Array.isArray(value)) {
		return Uint8Array.from(value as number[]);
	}
	if (typeof value === "string") {
		if (value.startsWith("0x")) {
			return hexToBytes(value);
		}
		return base64ToBytes(value);
	}
	return null;
}

function unwrapSerializedValue(value: unknown): unknown {
	if (!value || typeof value !== "object") {
		return value;
	}

	const record = value as Record<string, unknown>;
	const kind = typeof record.kind === "string" ? record.kind : null;
	if (!kind) {
		return value;
	}

	switch (kind) {
		case "null":
		case "Null":
			return null;
		case "bool":
		case "Boolean":
			return Boolean(record.value);
		case "int":
		case "Integer":
		case "float":
		case "Real":
			return record.value;
		case "text":
		case "Text":
			return typeof record.value === "string"
				? record.value
				: String(record.value ?? "");
		case "blob":
		case "Blob": {
			if (typeof record.base64 === "string") {
				return base64ToBytes(record.base64);
			}
			const decoded = decodeBlobLike(record.value);
			return decoded ?? new Uint8Array();
		}
		default:
			if ("value" in record) {
				return record.value;
			}
			return value;
	}
}

export function decodeMarkdownData(value: unknown): string {
	const raw = unwrapSerializedValue(value);
	if (raw === null || raw === undefined) return "";
	if (typeof raw === "string") {
		if (raw.startsWith("0x")) {
			return textDecoder.decode(hexToBytes(raw));
		}
		return raw;
	}
	if (raw instanceof Uint8Array) return textDecoder.decode(raw);
	if (raw instanceof ArrayBuffer)
		return textDecoder.decode(new Uint8Array(raw));
	if (ArrayBuffer.isView(raw)) {
		return textDecoder.decode(
			new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength),
		);
	}
	if (Array.isArray(raw)) {
		return textDecoder.decode(Uint8Array.from(raw as number[]));
	}
	if (typeof raw === "number" || typeof raw === "boolean") {
		return String(raw);
	}
	return "";
}
