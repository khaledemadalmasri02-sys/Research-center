import type { S3Client } from "@aws-sdk/client-s3";
import type { S3Object } from "./objectStorage";
import { logger } from "./logger";

const ACL_POLICY_METADATA_KEY = "aclPolicy";

/**
 * Access-group discriminators.
 *
 * This stays an EMPTY enum on purpose (see `createObjectAccessGroup` below):
 * the OpenAPI contract models ACL groups as a discriminated union, and adding
 * members here without a membership resolver — and without a matching spec
 * change — would invent sharing policy that nothing else in the platform
 * agrees on.
 */
export enum ObjectAccessGroupType {}

export interface ObjectAccessGroup {
  type: ObjectAccessGroupType;
  id: string;
}

export enum ObjectPermission {
  READ = "read",
  WRITE = "write",
}

export interface ObjectAclRule {
  group: ObjectAccessGroup;
  permission: ObjectPermission;
}

export interface ObjectAclPolicy {
  owner: string;
  visibility: "public" | "private";
  aclRules?: Array<ObjectAclRule>;
}

function isPermissionAllowed(
  requested: ObjectPermission,
  granted: ObjectPermission,
): boolean {
  if (requested === ObjectPermission.READ) {
    return [ObjectPermission.READ, ObjectPermission.WRITE].includes(granted);
  }
  return granted === ObjectPermission.WRITE;
}

abstract class BaseObjectAccessGroup implements ObjectAccessGroup {
  constructor(
    public readonly type: ObjectAccessGroupType,
    public readonly id: string,
  ) {}

  public abstract hasMember(userId: string): Promise<boolean>;
}

/**
 * Resolve an ACL group to something that can answer "is userId a member?".
 *
 * `ObjectAccessGroupType` is an empty enum (see the note above), so today no
 * group type is resolvable and this returns `null` for every rule. It used to
 * `throw`, which turned any object carrying an `aclRules` entry into an
 * unhandled 500 on the streaming path — a fail-*loud* path where we want to
 * fail *closed*.
 *
 * Degrading to "unresolvable ⇒ never grants" is smaller and safer than
 * inventing group types: it keeps the ACL contract intact for whoever wires
 * up real groups, and until then an object is readable only via an explicit
 * owner match or explicit public visibility.
 */
export function createObjectAccessGroup(
  group: ObjectAccessGroup,
): BaseObjectAccessGroup | null {
  switch (group?.type) {
    default:
      logger.warn(
        { groupType: (group as { type?: unknown } | undefined)?.type },
        "Unresolvable object ACL group type — rule ignored (deny)",
      );
      return null;
  }
}

/**
 * The api-server's configured S3 client (endpoint, region and credentials
 * from the env). Both ACL helpers used to build `new S3Client({})`, which
 * talks to real AWS with no credentials — so against MinIO every lookup
 * failed (and after a slow credential-provider timeout), silently degrading
 * the ACL check to "no policy found".
 *
 * Imported lazily because lib/objectStorage.ts imports this module.
 */
async function sharedS3Client(): Promise<S3Client> {
  const { s3Client } = await import("./objectStorage");
  return s3Client;
}

export async function setObjectAclPolicy(
  s3Object: S3Object,
  aclPolicy: ObjectAclPolicy,
): Promise<void> {
  const { PutObjectCommand, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await sharedS3Client();

  const response = await client.send(
    new GetObjectCommand({
      Bucket: s3Object.bucketName,
      Key: s3Object.key,
    })
  );

  await client.send(
    new PutObjectCommand({
      Bucket: s3Object.bucketName,
      Key: s3Object.key,
      Body: response.Body,
      ContentType: response.ContentType,
      Metadata: {
        [ACL_POLICY_METADATA_KEY]: JSON.stringify(aclPolicy),
      },
    })
  );
}

export async function getObjectAclPolicy(
  s3Object: S3Object
): Promise<ObjectAclPolicy | null> {
  const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
  const client = await sharedS3Client();

  try {
    const metadata = await client.send(
      new HeadObjectCommand({
        Bucket: s3Object.bucketName,
        Key: s3Object.key,
      })
    );

    const aclPolicy = metadata?.Metadata?.[ACL_POLICY_METADATA_KEY];
    if (!aclPolicy) {
      return null;
    }
    return JSON.parse(aclPolicy as string);
  } catch {
    return null;
  }
}

export async function canAccessObject({
  userId,
  objectFile,
  requestedPermission,
}: {
  userId?: string;
  objectFile: S3Object;
  requestedPermission: ObjectPermission;
}): Promise<boolean> {
  const aclPolicy = await getObjectAclPolicy(objectFile);
  if (!aclPolicy) {
    return false;
  }

  if (aclPolicy.visibility === "public" && requestedPermission === ObjectPermission.READ) {
    return true;
  }

  if (!userId) {
    return false;
  }

  if (aclPolicy.owner === userId) {
    return true;
  }

  for (const rule of aclPolicy.aclRules || []) {
    const accessGroup = createObjectAccessGroup(rule?.group);
    // Unresolvable group ⇒ this rule grants nothing (fail closed).
    if (
      accessGroup &&
      (await accessGroup.hasMember(userId)) &&
      isPermissionAllowed(requestedPermission, rule.permission)
    ) {
      return true;
    }
  }

  return false;
}