// Spike probe: generate models from the AsyncAPI document with Modelina, for one language.
import { TypeScriptGenerator, GoGenerator, RustGenerator } from "@asyncapi/modelina";
import { Parser, fromFile } from "@asyncapi/parser";
import { writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const [lang, outDir] = process.argv.slice(2);
const doc = resolve(import.meta.dirname, "../asyncapi.yaml");
const { document, diagnostics } = await fromFile(new Parser(), doc).parse();
if (!document) { console.error(diagnostics); process.exit(1); }
const gen = { ts: new TypeScriptGenerator({ modelType: "interface" }), go: new GoGenerator(), rust: new RustGenerator() }[lang];
const models = await gen.generate(document);
mkdirSync(outDir, { recursive: true });
for (const m of models) { writeFileSync(`${outDir}/${m.modelName}.${{ ts: "ts", go: "go", rust: "rs" }[lang]}`, `${m.dependencies?.join("\n") ?? ""}\n${m.result}\n`); }
console.log(lang, models.length, "models");
