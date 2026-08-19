import { randomUUID } from "node:crypto";

import {
	getS3MaxInlineBytes,
	getS3MaxUploadBytes,
	isS3Enabled,
} from "../config/env.js";
import {
	deleteObject,
	getObject,
	getPresignedPutUrl,
	headObject,
	putObject,
	s3Enabled,
	s3ErrorMessage,
} from "./s3.service.js";

/** Soft limit on base64/data-URL payloads when files go to MinIO (~15 MB decoded). */
const MAX_S3_ATTACHMENT_CHARS = 20_000_000;
/** Legacy Mongo-embedded limit (~1.8 MB decoded). */
const MAX_MONGO_ATTACHMENT_CHARS = 2_500_000;

export function maxAttachmentChars(): number {
	return s3Enabled() ? MAX_S3_ATTACHMENT_CHARS : MAX_MONGO_ATTACHMENT_CHARS;
}

export function maxDirectUploadBytes(): number {
	return getS3MaxUploadBytes();
}

export function maxInlineBytes(): number {
	return getS3MaxInlineBytes();
}

export function clampAttachmentPayload(data?: string): string {
	const value = data?.trim() ?? "";
	const max = maxAttachmentChars();
	if (value.length > max) {
		throw new Error(
			"Attachment is too large for inline upload. Use direct MinIO upload for files up to 2 GB.",
		);
	}
	return value;
}

export function decodeDataUrlOrBase64(value: string): { buffer: Buffer; mime: string | null } {
	const trimmed = value.trim();
	const match = trimmed.match(/^data:([^;,]+)?(?:;charset=[^;,]+)?(;base64)?,(.*)$/s);
	if (match) {
		const mime = match[1]?.trim() || null;
		const payload = match[3] ?? "";
		const buffer = match[2]
			? Buffer.from(payload, "base64")
			: Buffer.from(decodeURIComponent(payload), "utf8");
		return { buffer, mime };
	}
	return { buffer: Buffer.from(trimmed, "base64"), mime: null };
}

export function bufferToDataUrl(buffer: Buffer, mime: string): string {
	const type = mime.trim() || "application/octet-stream";
	return `data:${type};base64,${buffer.toString("base64")}`;
}

export function sanitizeStorageFileName(name: string): string {
	const base = name.trim().split(/[/\\]/).pop() || "file";
	const cleaned = base.replace(/[^a-zA-Z0-9._-]+/g, "_").replace(/_+/g, "_");
	return cleaned.slice(0, 120) || "file";
}

export function buildUploadKey(parts: {
	userId: string;
	kind: "documents" | "datasets" | "backups" | "assets";
	id: string;
	fileName: string;
}): string {
	const safe = sanitizeStorageFileName(parts.fileName);
	return `users/${parts.userId}/${parts.kind}/${parts.id}/${safe}`;
}

export type StoredAttachment = {
	/** MinIO object key when stored remotely; empty when embedded in Mongo. */
	storageKey: string;
	/** Empty when stored in MinIO; data-URL/base64 when S3 is disabled. */
	fileData: string;
	mime: string;
	byteLength: number;
};

/**
 * Persist an uploaded attachment. When S3/MinIO is configured, bytes go to the
 * bucket and Mongo only keeps `storageKey`. Otherwise falls back to Mongo `fileData`.
 */
export async function storeAttachment(input: {
	userId: string;
	kind: "documents" | "datasets" | "backups" | "assets";
	id?: string;
	fileName: string;
	fileMime?: string;
	fileData: string;
}): Promise<StoredAttachment> {
	const payload = clampAttachmentPayload(input.fileData);
	if (!payload) {
		throw new Error("A file is required.");
	}
	const decoded = decodeDataUrlOrBase64(payload);
	const mime =
		input.fileMime?.trim() || decoded.mime || "application/octet-stream";
	const id = input.id?.trim() || randomUUID();

	if (isS3Enabled()) {
		const storageKey = buildUploadKey({
			userId: input.userId,
			kind: input.kind,
			id,
			fileName: input.fileName,
		});
		try {
			await putObject({
				key: storageKey,
				body: decoded.buffer,
				contentType: mime,
				metadata: {
					userid: input.userId.slice(0, 64),
					kind: input.kind,
				},
			});
			return {
				storageKey,
				fileData: "",
				mime,
				byteLength: decoded.buffer.byteLength,
			};
		} catch (error) {
			if (payload.length <= MAX_MONGO_ATTACHMENT_CHARS) {
				console.warn(
					"[attachment-storage] MinIO upload failed; saving file in the database instead.",
					s3ErrorMessage(error),
				);
				return {
					storageKey: "",
					fileData: payload,
					mime,
					byteLength: decoded.buffer.byteLength,
				};
			}
			throw new Error(s3ErrorMessage(error));
		}
	}

	return {
		storageKey: "",
		fileData: payload,
		mime,
		byteLength: decoded.buffer.byteLength,
	};
}

/** Create a reserved object key + browser-facing presigned PUT URL (up to 2 GB). */
export async function createDirectUploadTarget(input: {
	userId: string;
	kind: "documents" | "datasets" | "backups" | "assets";
	id: string;
	fileName: string;
	fileMime?: string;
	fileSizeBytes: number;
}): Promise<{ storageKey: string; uploadUrl: string; mime: string; expiresInSeconds: number }> {
	if (!isS3Enabled()) {
		throw new Error("Direct uploads require S3/MinIO (S3_ENDPOINT + keys).");
	}
	const max = maxDirectUploadBytes();
	if (!Number.isFinite(input.fileSizeBytes) || input.fileSizeBytes < 1) {
		throw new Error("fileSizeBytes is required for direct upload.");
	}
	if (input.fileSizeBytes > max) {
		throw new Error(`File is too large. Maximum upload size is ${formatByteLabel(max)}.`);
	}
	const mime = input.fileMime?.trim() || "application/octet-stream";
	const storageKey = buildUploadKey({
		userId: input.userId,
		kind: input.kind,
		id: input.id,
		fileName: input.fileName,
	});
	const expiresInSeconds = 7200;
	const uploadUrl = await getPresignedPutUrl(storageKey, mime, expiresInSeconds);
	return { storageKey, uploadUrl, mime, expiresInSeconds };
}

export async function assertObjectUploaded(
	storageKey: string,
	expectedMinBytes = 1,
): Promise<{ contentLength: number; contentType: string | undefined }> {
	const meta = await headObject(storageKey);
	if (meta.contentLength < expectedMinBytes) {
		throw new Error("Upload incomplete — object is missing or empty in storage.");
	}
	return meta;
}

export async function loadAttachmentDataUrl(input: {
	storageKey?: string | null;
	fileData?: string | null;
	fileMime?: string | null;
	fileSizeBytes?: number | null;
}): Promise<string | null> {
	const embedded = input.fileData?.trim() ?? "";
	if (embedded) return embedded;

	const key = input.storageKey?.trim() ?? "";
	if (!key) return null;
	if (!isS3Enabled()) {
		throw new Error("File is stored in object storage, but S3 is not configured.");
	}

	let size = input.fileSizeBytes ?? 0;
	if (!size) {
		const meta = await headObject(key);
		size = meta.contentLength;
	}
	const inlineMax = maxInlineBytes();
	if (size > inlineMax) {
		throw new Error(
			`File is too large to load inline (${formatByteLabel(size)}; limit ${formatByteLabel(inlineMax)}). Download via MinIO instead.`,
		);
	}

	const { body, contentType } = await getObject(key);
	return bufferToDataUrl(body, contentType || input.fileMime || "application/octet-stream");
}

export async function loadAttachmentBuffer(input: {
	storageKey?: string | null;
	fileData?: string | null;
	fileSizeBytes?: number | null;
}): Promise<Buffer | null> {
	const dataUrl = await loadAttachmentDataUrl(input);
	if (!dataUrl) return null;
	return decodeDataUrlOrBase64(dataUrl).buffer;
}

export async function deleteStoredAttachment(storageKey?: string | null): Promise<void> {
	const key = storageKey?.trim() ?? "";
	if (!key || !isS3Enabled()) return;
	try {
		await deleteObject(key);
	} catch {
		/* best-effort cleanup */
	}
}

export function hasStoredAttachment(input: {
	storageKey?: string | null;
	fileData?: string | null;
}): boolean {
	return Boolean(input.storageKey?.trim() || input.fileData?.trim());
}

export function formatByteLabel(n: number): string {
	if (!Number.isFinite(n) || n < 0) return "0 B";
	if (n < 1024) return `${n} B`;
	if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
	if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
	return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
