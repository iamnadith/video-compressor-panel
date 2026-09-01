import "server-only"

import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

import { query } from "@/lib/db"

export type R2Config = {
  r2AccountId: string
  r2AccessKeyId: string
  r2SecretAccessKey: string
  r2Bucket: string
}

let cachedConfig: { value: R2Config; expiresAt: number } | undefined
let singleton: { key: string; client: S3Client } | undefined

export async function getR2Config(): Promise<R2Config> {
  if (cachedConfig && cachedConfig.expiresAt > Date.now()) return cachedConfig.value
  const result = await query<R2Config>("select r2_account_id as \"r2AccountId\", r2_access_key_id as \"r2AccessKeyId\", r2_secret_access_key as \"r2SecretAccessKey\", r2_bucket as \"r2Bucket\" from public.pipeline_settings where id = 1")
  const row = result.rows[0]
  if (!row?.r2AccountId || !row.r2AccessKeyId || !row.r2SecretAccessKey || !row.r2Bucket) {
    throw new Error("R2 is not configured. Open Dashboard > Settings and save the R2 credentials.")
  }
  cachedConfig = { value: row, expiresAt: Date.now() + 30_000 }
  return row
}

async function getR2Client(): Promise<{ client: S3Client; config: R2Config }> {
  const config = await getR2Config()
  const key = `${config.r2AccountId}\0${config.r2AccessKeyId}\0${config.r2SecretAccessKey}`
  if (!singleton || singleton.key !== key) {
    singleton = { key, client: new S3Client({
      region: "auto",
      endpoint: `https://${config.r2AccountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
      },
    }) }
  }
  return { client: singleton.client, config }
}

export async function listPrefix(prefix: string) {
  const { client, config } = await getR2Client()
  const objects: Array<{
    key: string
    etag: string
    size: number
    lastModified: Date | undefined
  }> = []
  let continuationToken: string | undefined

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.r2Bucket,
      Prefix: `${prefix.replace(/\/$/, "")}/`,
      ContinuationToken: continuationToken,
    }))
    for (const item of page.Contents ?? []) {
      if (!item.Key || item.Key.endsWith("/")) continue
      objects.push({
        key: item.Key,
        etag: (item.ETag ?? "").replaceAll('"', ""),
        size: item.Size ?? 0,
        lastModified: item.LastModified,
      })
    }
    continuationToken = page.NextContinuationToken
  } while (continuationToken)

  return objects
}

export async function listPrefixPage(
  prefix: string,
  continuationToken?: string,
  maxKeys = 500,
) {
  const { client, config } = await getR2Client()
  const page = await client.send(new ListObjectsV2Command({
    Bucket: config.r2Bucket,
    Prefix: `${prefix.replace(/\/$/, "")}/`,
    ContinuationToken: continuationToken,
    MaxKeys: maxKeys,
  }))

  return {
    objects: (page.Contents ?? [])
      .filter((item) => Boolean(item.Key) && !item.Key?.endsWith("/"))
      .map((item) => ({
        key: item.Key as string,
        etag: (item.ETag ?? "").replaceAll('"', ""),
        size: item.Size ?? 0,
        lastModified: item.LastModified,
      })),
    nextContinuationToken: page.NextContinuationToken,
    cycleComplete: !page.IsTruncated,
    bucket: config.r2Bucket,
  }
}

function isNotFound(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { name?: string; $metadata?: { httpStatusCode?: number } }
  return candidate.name === "NotFound" || candidate.$metadata?.httpStatusCode === 404
}

export async function headObject(key: string) {
  const { client, config } = await getR2Client()
  try {
    return await client.send(new HeadObjectCommand({ Bucket: config.r2Bucket, Key: key }))
  } catch (error) {
    if (isNotFound(error)) return null
    throw error
  }
}

export async function createJobTransferUrls(inputKey: string, outputKey: string) {
  const { client, config } = await getR2Client()
  const expiresIn = 60 * 60
  const [downloadUrl, uploadUrl] = await Promise.all([
    getSignedUrl(client, new GetObjectCommand({ Bucket: config.r2Bucket, Key: inputKey }), { expiresIn }),
    getSignedUrl(client, new PutObjectCommand({
      Bucket: config.r2Bucket,
      Key: outputKey,
      ContentType: "video/mp4",
    }), { expiresIn }),
  ])
  return { downloadUrl, uploadUrl, expiresIn }
}

export async function deleteClaimedObject(key: string, protectedKey?: string) {
  if (protectedKey && key === protectedKey) {
    throw new Error("Refusing to delete the processed output as pipeline input.")
  }
  const { client, config } = await getR2Client()
  await client.send(new DeleteObjectCommand({ Bucket: config.r2Bucket, Key: key }))
}

async function deleteObjectBatch(client: S3Client, bucket: string, keys: string[]) {
  if (!keys.length) return 0
  const result = await client.send(new DeleteObjectsCommand({
    Bucket: bucket,
    Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
  }))
  if (result.Errors?.length) {
    const firstError = result.Errors[0]
    throw new Error(`R2 refused to delete ${result.Errors.length} object(s): ${firstError?.Message ?? firstError?.Code ?? "unknown error"}`)
  }
  return keys.length
}

async function deleteListedObjects(prefix?: string) {
  const { client, config } = await getR2Client()
  let continuationToken: string | undefined
  let deleted = 0

  do {
    const page = await client.send(new ListObjectsV2Command({
      Bucket: config.r2Bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }))
    const keys = (page.Contents ?? [])
      .map((item) => item.Key)
      .filter((key): key is string => Boolean(key))
    deleted += await deleteObjectBatch(client, config.r2Bucket, keys)
    continuationToken = page.NextContinuationToken
  } while (continuationToken)

  return { deleted, bucket: config.r2Bucket }
}

export async function deleteR2Prefix(prefix: string) {
  const normalizedPrefix = prefix.trim().replace(/\/+$/, "")
  if (!normalizedPrefix) throw new Error("Refusing to delete an empty R2 prefix.")
  return deleteListedObjects(`${normalizedPrefix}/`)
}

export async function deleteR2Bucket() {
  return deleteListedObjects()
}
