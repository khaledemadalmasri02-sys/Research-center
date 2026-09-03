// The orval-generated `api.ts` exports zod schemas. Each schema's
// inferred type (via `z.infer<typeof Schema>`) is the canonical
// type. We don't re-export a separate `types/` module because
// that previously caused TS2308 "already exported" collisions
// when both the zod `const` schema and the TypeScript `interface`
// were re-exported under the same name.
//
// Schemas are accessible as values:
//   import { CreatePatientBody } from "@workspace/api-zod";
//
// And the inferred types are accessible as types:
//   import type { CreatePatientBody } from "@workspace/api-zod";
export * from "./generated/api";

export * from './generated/api';
