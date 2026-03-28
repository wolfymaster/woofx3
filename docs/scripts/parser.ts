import { relative, resolve } from "node:path";
import {
  ClassDeclaration,
  type FunctionDeclaration,
  InterfaceDeclaration,
  type JSDocableNode,
  type MethodDeclaration,
  type MethodSignature,
  Node,
  type ParameterDeclaration,
  Project,
  PropertyDeclaration,
  type SourceFile,
  TypeAliasDeclaration,
} from "ts-morph";
import type { ServiceConfig } from "./config.js";

export interface ParsedParameter {
  name: string;
  type: string;
  hasQuestionToken: boolean;
}

export interface ParsedProperty {
  name: string;
  type: string;
  isReadonly: boolean;
  hasQuestionToken: boolean;
  line: number;
}

export interface ParsedMethod {
  name: string;
  signature: string;
  returnType: string;
  parameters: ParsedParameter[];
  jsdoc: string;
  line: number;
}

export interface ParsedClass {
  name: string;
  extends?: string;
  implements?: string[];
  methods: ParsedMethod[];
  properties: ParsedProperty[];
  jsdoc: string;
  line: number;
}

export interface ParsedFunction {
  name: string;
  signature: string;
  returnType: string;
  parameters: ParsedParameter[];
  jsdoc: string;
  line: number;
}

export interface ParsedTypeAlias {
  name: string;
  type: string;
  jsdoc: string;
  line: number;
}

export interface ParsedInterface {
  name: string;
  extends?: string[];
  methods: ParsedMethod[];
  properties: ParsedProperty[];
  jsdoc: string;
  line: number;
}

export interface ParsedFile {
  filePath: string;
  relativePath: string;
  classes: ParsedClass[];
  interfaces: ParsedInterface[];
  typeAliases: ParsedTypeAlias[];
  functions: ParsedFunction[];
  exports: { name: string; type: string; jsdoc: string; line: number }[];
}

function getJsdoc(node: JSDocableNode): string {
  const jsdocs = node.getJsDocs();
  if (jsdocs.length === 0) return "";
  return jsdocs
    .map((j) => j.getDescription())
    .filter(Boolean)
    .join("\n");
}

function getParameters(params: ParameterDeclaration[]): ParsedParameter[] {
  return params.map((p) => ({
    name: p.getName(),
    type: p.getType().getText(),
    hasQuestionToken: p.hasQuestionToken(),
  }));
}

function getHeritage(heritage: Node | undefined): string | undefined {
  if (!heritage) return undefined;
  if (Node.isHeritageClause(heritage)) {
    return heritage
      .getTypeNodes()
      .map((t) => t.getText())
      .join(", ");
  }
  return heritage.getText();
}

function getMethodSignatureString(method: MethodSignature | FunctionDeclaration): string {
  const params = method.getParameters();
  const paramStr = params
    .map((p) => {
      const name = p.getName();
      const type = p.getType().getText();
      return p.hasQuestionToken() ? `${name}?: ${type}` : `${name}: ${type}`;
    })
    .join(", ");
  const returnType = method.getReturnTypeNode()?.getText() || "unknown";
  return `(${paramStr}): ${returnType}`;
}

function getMethodDeclarationSignature(method: MethodDeclaration): string {
  const params = method.getParameters();
  const paramStr = params
    .map((p) => {
      const name = p.getName();
      const type = p.getType().getText();
      return p.hasQuestionToken() ? `${name}?: ${type}` : `${name}: ${type}`;
    })
    .join(", ");
  const returnType = method.getReturnTypeNode()?.getText() || "unknown";
  return `(${paramStr}): ${returnType}`;
}

function getFunctionSignatureString(func: FunctionDeclaration): string {
  const params = func.getParameters();
  const paramStr = params
    .map((p) => {
      const name = p.getName();
      const type = p.getType().getText();
      return p.hasQuestionToken() ? `${name}?: ${type}` : `${name}: ${type}`;
    })
    .join(", ");
  const returnType = func.getReturnTypeNode()?.getText() || "unknown";
  return `(${paramStr}): ${returnType}`;
}

export function parseSourceFile(sourceFile: SourceFile, sourceDir: string): ParsedFile {
  const filePath = sourceFile.getFilePath();
  // Calculate relative path for GitHub links
  const rootDir = resolve(process.cwd(), "..");
  const relativePath = relative(rootDir, filePath);

  const classes: ParsedClass[] = [];
  const interfaces: ParsedInterface[] = [];
  const typeAliases: ParsedTypeAlias[] = [];
  const functions: ParsedFunction[] = [];
  const exports: { name: string; type: string; jsdoc: string; line: number }[] = [];

  // Parse classes
  for (const cls of sourceFile.getClasses()) {
    if (!cls.isExported()) continue;

    const methods: ParsedMethod[] = [];
    const properties: ParsedProperty[] = [];

    for (const method of cls.getMethods()) {
      const methodName = method.getName();
      if (methodName === "constructor") continue;

      methods.push({
        name: methodName,
        signature: getMethodDeclarationSignature(method),
        returnType: method.getReturnType().getText(),
        parameters: getParameters(method.getParameters()),
        jsdoc: getJsdoc(method),
        line: method.getStartLineNumber(),
      });
    }

    for (const prop of cls.getProperties()) {
      properties.push({
        name: prop.getName(),
        type: prop.getType().getText(),
        isReadonly: prop.isReadonly(),
        hasQuestionToken: prop.hasQuestionToken(),
        line: prop.getStartLineNumber(),
      });
    }

    const extendsClause = cls.getExtends();
    const implementsClause = cls.getImplements();

    classes.push({
      name: cls.getName() || "AnonymousClass",
      extends: extendsClause ? getHeritage(extendsClause) : undefined,
      implements: implementsClause.length > 0 ? implementsClause.map((i) => i.getText()) : undefined,
      methods,
      properties,
      jsdoc: getJsdoc(cls),
      line: cls.getStartLineNumber(),
    });
  }

  // Parse interfaces
  for (const iface of sourceFile.getInterfaces()) {
    if (!iface.isExported()) continue;

    const methods: ParsedMethod[] = [];
    const properties: ParsedProperty[] = [];

    for (const method of iface.getMethods()) {
      methods.push({
        name: method.getName(),
        signature: getMethodSignatureString(method),
        returnType: method.getReturnType().getText(),
        parameters: getParameters(method.getParameters()),
        jsdoc: getJsdoc(method),
        line: method.getStartLineNumber(),
      });
    }

    for (const prop of iface.getProperties()) {
      properties.push({
        name: prop.getName(),
        type: prop.getType().getText(),
        isReadonly: prop.isReadonly(),
        hasQuestionToken: prop.hasQuestionToken(),
        line: prop.getStartLineNumber(),
      });
    }

    const extendsClause = iface.getExtends();

    interfaces.push({
      name: iface.getName() || "AnonymousInterface",
      extends: extendsClause.length > 0 ? extendsClause.map((e) => e.getText()) : undefined,
      methods,
      properties,
      jsdoc: getJsdoc(iface),
      line: iface.getStartLineNumber(),
    });
  }

  // Parse type aliases
  for (const typeAlias of sourceFile.getTypeAliases()) {
    if (!typeAlias.isExported()) continue;

    typeAliases.push({
      name: typeAlias.getName(),
      type: typeAlias.getType().getText(),
      jsdoc: getJsdoc(typeAlias),
      line: typeAlias.getStartLineNumber(),
    });
  }

  // Parse exported functions
  for (const func of sourceFile.getFunctions()) {
    if (!func.isExported()) continue;

    functions.push({
      name: func.getName() || "AnonymousFunction",
      signature: getFunctionSignatureString(func),
      returnType: func.getReturnType().getText(),
      parameters: getParameters(func.getParameters()),
      jsdoc: getJsdoc(func),
      line: func.getStartLineNumber(),
    });
  }

  // Parse exported declarations
  const exportedDecls = sourceFile.getExportedDeclarations();
  for (const [name, declarations] of exportedDecls) {
    const declaration = declarations[0];
    if (!declaration) continue;

    let type = "unknown";
    if (Node.isVariableDeclaration(declaration)) {
      type = declaration.getType().getText();
    } else if (Node.isClassDeclaration(declaration)) {
      type = "class";
    } else if (Node.isInterfaceDeclaration(declaration)) {
      type = "interface";
    } else if (Node.isTypeAliasDeclaration(declaration)) {
      type = "type";
    } else if (Node.isFunctionDeclaration(declaration)) {
      type = "function";
    }

    exports.push({
      name,
      type,
      jsdoc: Node.isJSDocable(declaration) ? getJsdoc(declaration) : "",
      line: declaration.getStartLineNumber(),
    });
  }

  return {
    filePath,
    relativePath,
    classes,
    interfaces,
    typeAliases,
    functions,
    exports,
  };
}

export function parseService(config: ServiceConfig): ParsedFile[] {
  const project = new Project({});

  const results: ParsedFile[] = [];

  // Add root path to sourceDir since we're running from docs folder
  const sourceDir = resolve(process.cwd(), "..", config.sourceDir);

  for (const entry of config.entries) {
    const filePath = resolve(sourceDir, entry.file);

    try {
      const sourceFile = project.addSourceFileAtPath(filePath);
      results.push(parseSourceFile(sourceFile, config.sourceDir));
    } catch (err) {
      console.warn(`Failed to parse ${entry.file}:`, err);
    }
  }

  return results;
}
