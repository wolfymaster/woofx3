#!/usr/bin/env bash
# Builds every generator input in work/ from in/. Usage: build-inputs.sh
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/.."
mkdir -p work
bun tools/mkdoc.ts in/schemas work/nats.31.json
bunx openapi-down-convert -i work/nats.31.json -o work/nats.30.raw.json
bun tools/fix30.ts work/nats.30.raw.json work/nats.30.yaml
rm work/nats.30.raw.json
cp work/nats.31.json work/nats.31.yaml
bun tools/slice.ts in/marketplace.yaml work/slice.31.yaml getCatalogEntry updateModule adminGrantEntitlement revokeEntitlement
bunx openapi-down-convert -i work/slice.31.yaml -o work/slice.30.raw.yaml
bun tools/fix30.ts work/slice.30.raw.yaml work/slice.30.yaml
rm work/slice.30.raw.yaml
# ogen 1.25.0 emits a call to an undefined validateUnique<T> for uniqueItems on object items, so the ogen input drops that one keyword.
for v in 30 31; do
  src=work/nats.$v.yaml
  bun -e '
    import { parse, stringify } from "yaml"; import { readFileSync, writeFileSync } from "node:fs";
    const d = parse(readFileSync(process.argv[1], "utf8"));
    delete d.components.schemas.FieldOptionsList.uniqueItems;
    writeFileSync(process.argv[2], stringify(d, { lineWidth: 0 }));' "$src" "work/nats.$v.ogen.yaml"
done
