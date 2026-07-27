import {
	DeleteObjectCommand,
	GetObjectCommand,
	HeadBucketCommand,
	HeadObjectCommand,
	PutObjectCommand,
	S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { getS3Config, isS3Enabled, type S3Config } from "../config/env.js";

let client: S3Client | null = null;
let cachedConfig: S3Config | null = null;

function getClient(): { client: S3Client; config: S3Config } {
	const config = getS3Config();
	if (
		!client ||
		!cachedConfig ||
		cachedConfig.endpoint !== config.endpoint ||
		cachedConfig.accessKeyId !== config.accessKeyId ||
		cachedConfig.bucket !== config.bucket
	) {
		client = new S3Client({
			endpoint: config.endpoint,
			region: config.region,
			credentials: {
				accessKeyId: config.accessKeyId,
				secretAccessKey: config.secretAccessKey,
			},
			forcePathStyle: config.forcePathStyle,
		});
		cachedConfig = config;
	}
	return { client, config };
}

export function s3Enabled(): boolean {
	return isS3Enabled();
}

export async function assertS3Ready(): Promise<void> {
	const { client: s3, config } = getClient();
	await s3.send(new HeadBucketCommand({ Bucket: config.bucket }));
}

export type PutObjectInput = {
	key: string;
	body: Buffer | Uint8Array | string;
	contentType?: string;
	metadata?: Record<string, string>;
};

export async function putObject(input: PutObjectInput): Promise<{ key: string; url: string }> {
	const { client: s3, config } = getClient();
	const body =
		typeof input.body === "string" ? Buffer.from(input.body, "utf8") : input.body;
	await s3.send(
		new PutObjectCommand({
			Bucket: config.bucket,
			Key: input.key,
			Body: body,
			ContentType: input.contentType,
			Metadata: input.metadata,
		}),
	);
	return { key: input.key, url: objectUrl(input.key) };
}

export async function getObject(
	key: string,
): Promise<{ body: Buffer; contentType: string | undefined; contentLength?: number }> {
	const { client: s3, config } = getClient();
	const result = await s3.send(
		new GetObjectCommand({
			Bucket: config.bucket,
			Key: key,
		}),
	);
	const bytes = await result.Body?.transformToByteArray();
	if (!bytes) {
		throw new Error(`S3 object empty or missing: ${key}`);
	}
	return {
		body: Buffer.from(bytes),
		contentType: result.ContentType,
		contentLength: result.ContentLength,
	};
}

export async function headObject(
	key: string,
): Promise<{ contentType: string | undefined; contentLength: number }> {
	const { client: s3, config } = getClient();
	const result = await s3.send(
		new HeadObjectCommand({
			Bucket: config.bucket,
			Key: key,
		}),
	);
	return {
		contentType: result.ContentType,
		contentLength: result.ContentLength ?? 0,
	};
}

export async function deleteObject(key: string): Promise<void> {
	const { client: s3, config } = getClient();
	await s3.send(
		new DeleteObjectCommand({
			Bucket: config.bucket,
			Key: key,
		}),
	);
}

/** Path-style public URL (works with MinIO behind https://s3.garilai.com). */
export function objectUrl(key: string): string {
	const { config } = getClient();
	const base = config.publicUrl || config.endpoint;
	const encodedKey = key
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
	return `${base}/${config.bucket}/${encodedKey}`;
}

export async function getPresignedGetUrl(
	key: string,
	expiresInSeconds = 3600,
): Promise<string> {
	const { client: s3, config } = getClient();
	const command = new GetObjectCommand({
		Bucket: config.bucket,
		Key: key,
	});
	return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}

export async function getPresignedPutUrl(
	key: string,
	contentType?: string,
	expiresInSeconds = 7200,
): Promise<string> {
	const { client: s3, config } = getClient();
	const command = new PutObjectCommand({
		Bucket: config.bucket,
		Key: key,
		ContentType: contentType,
	});
	return getSignedUrl(s3, command, { expiresIn: expiresInSeconds });
}
