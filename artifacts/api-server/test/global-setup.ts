import {
  PostgreSqlContainer,
  type StartedPostgreSqlContainer,
} from "@testcontainers/postgresql";
import { GenericContainer, type StartedTestContainer } from "testcontainers";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let pgContainer: StartedPostgreSqlContainer | null = null;
let minioContainer: StartedTestContainer | null = null;

const URL_FILE = path.join(
  os.tmpdir(),
  `mednexus-test-db-${process.pid}.url`,
);
const MINIO_URL_FILE = path.join(
  os.tmpdir(),
  `mednexus-test-minio-${process.pid}.url`,
);

export async function setup(): Promise<void> {
  pgContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("mednexus_test")
    .withUsername("test")
    .withPassword("test")
    .withEnvironment({ TZ: "UTC", PGTZ: "UTC" })
    .start();
  const pgUrl = pgContainer.getConnectionUri();
  fs.writeFileSync(URL_FILE, pgUrl, "utf8");

  // MinIO for S3-compatible object storage. We use a fixed access key
  // (test/test) so setup-env.ts can set the same env vars the api-server
  // expects.
  minioContainer = await new GenericContainer("minio/minio:latest")
    .withEnvironment({
      MINIO_ROOT_USER: "minioadmin",
      MINIO_ROOT_PASSWORD: "minioadmin",
    })
    .withCommand(["server", "/data", "--console-address", ":9001"])
    .withExposedPorts(9000)
    .start();
  const host = minioContainer.getHost();
  const port = minioContainer.getMappedPort(9000);
  const minioUrl = `http://${host}:${port}`;
  fs.writeFileSync(MINIO_URL_FILE, minioUrl, "utf8");

  (
    globalThis as { __TEST_DB__?: StartedPostgreSqlContainer }
  ).__TEST_DB__ = pgContainer;
  (
    globalThis as { __TEST_MINIO__?: StartedTestContainer }
  ).__TEST_MINIO__ = minioContainer;
}

export async function teardown(): Promise<void> {
  const pg = (globalThis as { __TEST_DB__?: StartedPostgreSqlContainer })
    .__TEST_DB__;
  if (pg) await pg.stop().catch(() => undefined);
  const mn = (globalThis as { __TEST_MINIO__?: StartedTestContainer })
    .__TEST_MINIO__;
  if (mn) await mn.stop().catch(() => undefined);
  for (const f of [URL_FILE, MINIO_URL_FILE]) {
    try {
      fs.unlinkSync(f);
    } catch {
      /* file may already be gone */
    }
  }
}

export const __TEST_DB_URL_FILE__ = URL_FILE;
export const __TEST_MINIO_URL_FILE__ = MINIO_URL_FILE;