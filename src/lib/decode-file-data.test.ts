import { describe, expect, test } from "vitest";
import {
	decodeFileDataToBytes,
	decodeFileDataToText,
} from "./decode-file-data";

describe("decode file data", () => {
	test("decodes serialized blob values from base64 value fields", () => {
		const data = { kind: "Blob", value: "SGVsbG8K" };

		expect(Array.from(decodeFileDataToBytes(data))).toEqual([
			72, 101, 108, 108, 111, 10,
		]);
		expect(decodeFileDataToText(data)).toBe("Hello\n");
	});

	test("decodes serialized blob values from hex value fields", () => {
		expect(decodeFileDataToText({ kind: "blob", value: "0x4869" })).toBe("Hi");
	});
});
