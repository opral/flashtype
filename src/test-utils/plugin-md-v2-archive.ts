import markdownPluginV2Manifest from "../../submodule/lix/packages/plugin-md-v2/manifest.json";
import markdownPluginV2WasmRaw from "../../submodule/lix/target/wasm32-wasip2/release/plugin_md_v2.wasm?raw";
import markdownDocumentSchema from "../../submodule/lix/packages/plugin-md-v2/schema/markdown_document.json";
import markdownBlockSchema from "../../submodule/lix/packages/plugin-md-v2/schema/markdown_block.json";

function crc32(input: Uint8Array): number {
	let crc = 0xffffffff;
	for (let index = 0; index < input.length; index += 1) {
		crc ^= input[index]!;
		for (let bit = 0; bit < 8; bit += 1) {
			const mask = -(crc & 1);
			crc = (crc >>> 1) ^ (0xedb88320 & mask);
		}
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function concatChunks(chunks: Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const output = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		output.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return output;
}

function createStoredZip(
	entries: Array<{ name: string; data: Uint8Array }>,
): Uint8Array {
	const encoder = new TextEncoder();
	const localChunks: Uint8Array[] = [];
	const centralChunks: Uint8Array[] = [];
	let localOffset = 0;

	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const data = entry.data;
		const crc = crc32(data);

		const localHeader = new Uint8Array(30 + name.byteLength);
		const localView = new DataView(localHeader.buffer);
		localView.setUint32(0, 0x04034b50, true);
		localView.setUint16(4, 20, true);
		localView.setUint16(6, 0, true);
		localView.setUint16(8, 0, true);
		localView.setUint16(10, 0, true);
		localView.setUint16(12, 0, true);
		localView.setUint32(14, crc, true);
		localView.setUint32(18, data.byteLength, true);
		localView.setUint32(22, data.byteLength, true);
		localView.setUint16(26, name.byteLength, true);
		localView.setUint16(28, 0, true);
		localHeader.set(name, 30);

		const centralHeader = new Uint8Array(46 + name.byteLength);
		const centralView = new DataView(centralHeader.buffer);
		centralView.setUint32(0, 0x02014b50, true);
		centralView.setUint16(4, 20, true);
		centralView.setUint16(6, 20, true);
		centralView.setUint16(8, 0, true);
		centralView.setUint16(10, 0, true);
		centralView.setUint16(12, 0, true);
		centralView.setUint16(14, 0, true);
		centralView.setUint32(16, crc, true);
		centralView.setUint32(20, data.byteLength, true);
		centralView.setUint32(24, data.byteLength, true);
		centralView.setUint16(28, name.byteLength, true);
		centralView.setUint16(30, 0, true);
		centralView.setUint16(32, 0, true);
		centralView.setUint16(34, 0, true);
		centralView.setUint16(36, 0, true);
		centralView.setUint32(38, 0, true);
		centralView.setUint32(42, localOffset, true);
		centralHeader.set(name, 46);

		localChunks.push(localHeader, data);
		centralChunks.push(centralHeader);
		localOffset += localHeader.byteLength + data.byteLength;
	}

	const central = concatChunks(centralChunks);
	const eocd = new Uint8Array(22);
	const eocdView = new DataView(eocd.buffer);
	eocdView.setUint32(0, 0x06054b50, true);
	eocdView.setUint16(4, 0, true);
	eocdView.setUint16(6, 0, true);
	eocdView.setUint16(8, entries.length, true);
	eocdView.setUint16(10, entries.length, true);
	eocdView.setUint32(12, central.byteLength, true);
	eocdView.setUint32(16, localOffset, true);
	eocdView.setUint16(20, 0, true);

	return concatChunks([...localChunks, central, eocd]);
}

const markdownPluginV2WasmBytes = Uint8Array.from(
	markdownPluginV2WasmRaw,
	(char) => char.charCodeAt(0),
);

export const markdownPluginV2ArchiveBytes = createStoredZip([
	{
		name: "manifest.json",
		data: new TextEncoder().encode(JSON.stringify(markdownPluginV2Manifest)),
	},
	{ name: "plugin.wasm", data: markdownPluginV2WasmBytes },
	{
		name: "schema/markdown_document.json",
		data: new TextEncoder().encode(JSON.stringify(markdownDocumentSchema)),
	},
	{
		name: "schema/markdown_block.json",
		data: new TextEncoder().encode(JSON.stringify(markdownBlockSchema)),
	},
]);
