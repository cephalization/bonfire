// Run with: pnpm --filter @bonfire/sdk generate
/**
 * SDK Generator Script
 *
 * Generates TypeScript SDK from OpenAPI specification.
 * Creates type-safe client with methods for all API endpoints.
 *
 * Usage:
 *   pnpm --filter @bonfire/sdk generate
 *
 * Advanced:
 *   OPENAPI_URL=http://localhost:3000/api/openapi.json pnpm --filter @bonfire/sdk generate
 *   pnpm exec tsx scripts/generate-sdk.ts -- --local /path/to/openapi.json
 */

import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { join } from "path";

const OPENAPI_URL = process.env.OPENAPI_URL || "http://localhost:3000/api/openapi.json";
const SDK_OUTPUT_DIR = "packages/sdk/src";

interface OpenAPISpec {
  openapi: string;
  info: {
    title: string;
    version: string;
    description?: string;
  };
  paths?: Record<string, PathItem>;
  components?: {
    schemas?: Record<string, Schema>;
  };
}

interface PathItem {
  get?: Operation;
  post?: Operation;
  put?: Operation;
  delete?: Operation;
  patch?: Operation;
}

interface Operation {
  operationId?: string;
  summary?: string;
  description?: string;
  tags?: string[];
  requestBody?: {
    content?: {
      "application/json"?: {
        schema?: Schema;
      };
    };
  };
  parameters?: Parameter[];
  responses?: Record<string, Response>;
}

interface Parameter {
  name: string;
  in: "path" | "query" | "header";
  required?: boolean;
  schema?: Schema;
}

interface Response {
  description?: string;
  content?: {
    "application/json"?: {
      schema?: Schema;
    };
  };
}

interface Schema {
  type?: string;
  properties?: Record<string, Schema>;
  required?: string[];
  items?: Schema;
  $ref?: string;
  enum?: string[];
  format?: string;
  description?: string;
  example?: unknown;
}

/**
 * Parse command line arguments
 */
function parseArgs(): { local?: string } {
  const args = process.argv.slice(2);
  const local = args.find((_, i) => args[i - 1] === "--local");
  return { local };
}

/**
 * Fetch OpenAPI spec from running API server or local file
 */
async function fetchOpenAPISpec(localPath?: string): Promise<OpenAPISpec> {
  if (localPath) {
    console.log(`Loading OpenAPI spec from ${localPath}...`);
    const content = readFileSync(localPath, "utf-8");
    return JSON.parse(content);
  }

  console.log(`Fetching OpenAPI spec from ${OPENAPI_URL}...`);

  try {
    const response = await fetch(OPENAPI_URL);
    if (!response.ok) {
      throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
    }
    return await response.json();
  } catch (error) {
    console.error("Error fetching OpenAPI spec:", error);
    console.error("Make sure the API server is running on port 3000");
    console.error("Or provide a local spec file: --local ./spec.json");
    process.exit(1);
  }
}

/**
 * Convert a schema name to a valid TypeScript type name
 */
function toTypeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "");
}

/**
 * Convert OpenAPI schema to TypeScript type definition
 */
function schemaToTypeScript(name: string, schema: Schema, schemas: Record<string, Schema>): string {
  const typeDef = generateTypeFromSchema(schema, schemas, 0);
  return `export interface ${toTypeName(name)} ${typeDef}`;
}

/**
 * Generate TypeScript type from schema
 */
function generateTypeFromSchema(schema: Schema, schemas: Record<string, Schema>, indent: number): string {
  if (schema.$ref) {
    const refName = schema.$ref.replace("#/components/schemas/", "");
    return toTypeName(refName);
  }

  if (schema.enum) {
    return schema.enum.map((e) => `"${e}"`).join(" | ");
  }

  switch (schema.type) {
    case "string":
      return "string";
    case "integer":
    case "number":
      return "number";
    case "boolean":
      return "boolean";
    case "array":
      if (schema.items) {
        const itemType = generateTypeFromSchema(schema.items, schemas, indent);
        return `${itemType}[]`;
      }
      return "unknown[]";
    case "object":
      if (schema.properties) {
        const indentStr = "  ".repeat(indent + 1);
        const properties = Object.entries(schema.properties)
          .map(([propName, propSchema]) => {
            const isRequired = schema.required?.includes(propName);
            const propType = generateTypeFromSchema(propSchema, schemas, indent + 1);
            return `${indentStr}${propName}${isRequired ? "" : "?"}: ${propType};`;
          })
          .join("\n");
        return `{\n${properties}\n${"  ".repeat(indent)}}`;
      }
      return "Record<string, unknown>";
    default:
      return "unknown";
  }
}

/**
 * Generate types.ts content
 */
function generateTypes(spec: OpenAPISpec): string {
  const lines: string[] = [
    "/**",
    " * Bonfire SDK Types",
    " *",
    " * Auto-generated from OpenAPI specification.",
    " * Do not edit manually.",
    " */",
    "",
  ];

  // Generate types from schemas
  if (spec.components?.schemas) {
    lines.push("// API Types");
    lines.push("");

    for (const [name, schema] of Object.entries(spec.components.schemas)) {
      lines.push(schemaToTypeScript(name, schema, spec.components.schemas));
      lines.push("");
    }
  }

  // Generate types from paths
  if (spec.paths) {
    const requestTypes: string[] = [];
    const responseTypes: string[] = [];

    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const operations = [
        { method: "get", op: pathItem.get },
        { method: "post", op: pathItem.post },
        { method: "put", op: pathItem.put },
        { method: "delete", op: pathItem.delete },
        { method: "patch", op: pathItem.patch },
      ].filter((x): x is { method: string; op: Operation } => !!x.op);

      for (const { method, op } of operations) {
        const operationId = op.operationId || `${method}${path.replace(/[^a-zA-Z0-9]/g, "_")}`;

        // Request body type
        if (op.requestBody?.content?.["application/json"]?.schema) {
          const reqSchema = op.requestBody.content["application/json"].schema;
          const typeName = `${toTypeName(operationId)}Request`;
          const typeValue = generateTypeFromSchema(reqSchema, spec.components?.schemas || {}, 0);
          // Use type alias for simple references, interface for object types
          if (reqSchema.$ref) {
            requestTypes.push(`export type ${typeName} = ${typeValue};`);
          } else {
            requestTypes.push(`export interface ${typeName} ${typeValue}`);
          }
        }

        // Response types (success responses only)
        for (const [code, response] of Object.entries(op.responses || {})) {
          if (code.startsWith("2") && response.content?.["application/json"]?.schema) {
            const resSchema = response.content["application/json"].schema;
            const typeName = `${toTypeName(operationId)}Response`;
            const typeValue = generateTypeFromSchema(resSchema, spec.components?.schemas || {}, 0);
            // Use type alias for simple references, interface for object types
            if (resSchema.$ref) {
              responseTypes.push(`export type ${typeName} = ${typeValue};`);
            } else {
              responseTypes.push(`export interface ${typeName} ${typeValue}`);
            }
            break; // Only first success response
          }
        }
      }
    }

    if (requestTypes.length > 0) {
      lines.push("// Request Types");
      lines.push("");
      lines.push(...requestTypes);
      lines.push("");
    }

    if (responseTypes.length > 0) {
      lines.push("// Response Types");
      lines.push("");
      lines.push(...responseTypes);
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Collect all types that need to be imported
 */
function collectTypes(spec: OpenAPISpec): Set<string> {
  const types = new Set<string>();

  // Add schema types
  if (spec.components?.schemas) {
    for (const name of Object.keys(spec.components.schemas)) {
      types.add(toTypeName(name));
    }
  }

  // Add operation response/request types
  if (spec.paths) {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const ops = [
        { method: "get", op: pathItem.get },
        { method: "post", op: pathItem.post },
        { method: "put", op: pathItem.put },
        { method: "delete", op: pathItem.delete },
        { method: "patch", op: pathItem.patch },
      ].filter((x): x is { method: string; op: Operation } => !!x.op);

      for (const { method, op } of ops) {
        const operationId = op.operationId || `${method}${path.replace(/[^a-zA-Z0-9]/g, "_")}`;

        for (const [code, response] of Object.entries(op.responses || {})) {
          if (code.startsWith("2") && response.content?.["application/json"]?.schema) {
            const typeName = `${toTypeName(operationId)}Response`;
            types.add(typeName);
            break;
          }
        }

        if (op.requestBody?.content?.["application/json"]?.schema) {
          const typeName = `${toTypeName(operationId)}Request`;
          types.add(typeName);
        }
      }
    }
  }

  return types;
}

/**
 * Generate client.ts content
 */
function generateClient(spec: OpenAPISpec): string {
  const types = collectTypes(spec);
  const typeArray = Array.from(types);

  const parts: string[] = [
    "/**",
    " * Bonfire SDK Client",
    " *",
    " * Auto-generated from OpenAPI specification.",
    " * Do not edit manually.",
    " */",
    "",
    'import type {',
    `  ${typeArray.join(",\n  ")}`,
    '} from "./types";',
    "",
    "export interface ClientConfig {",
    "  baseUrl?: string;",
    "  token?: string;",
    "}",
    "",
    "export class BonfireClient {",
    "  private baseUrl: string;",
    "  private token?: string;",
    "",
    "  constructor(config: ClientConfig = {}) {",
    '    this.baseUrl = config.baseUrl || "http://localhost:3000";',
    "    this.token = config.token;",
    "  }",
    "",
    "  private async request<T>(",
    "    method: string,",
    "    path: string,",
    "    options: { body?: unknown; params?: Record<string, string> } = {}",
    "  ): Promise<T> {",
    "    const url = new URL(path, this.baseUrl);",
    "",
    "    if (options.params) {",
    "      Object.entries(options.params).forEach(([key, value]) => {",
    "        url.searchParams.set(key, value);",
    "      });",
    "    }",
    "",
    '    const headers: Record<string, string> = {',
    '      "Content-Type": "application/json",',
    "    };",
    "",
    "    if (this.token) {",
    '      headers["Authorization"] = `Bearer ${this.token}`;',
    "    }",
    "",
    "    const response = await fetch(url.toString(), {",
    "      method,",
    "      headers,",
    "      body: options.body ? JSON.stringify(options.body) : undefined,",
    "    });",
    "",
    "    if (!response.ok) {",
    '      const error = await response.json().catch(() => ({ error: "Unknown error" }));',
    "      throw new Error(error.error || `HTTP ${response.status}`);",
    "    }",
    "",
    "    return response.json();",
    "  }",
  ];

  // Generate API methods
  if (spec.paths) {
    for (const [path, pathItem] of Object.entries(spec.paths)) {
      const operations = [
        { method: "get", op: pathItem.get },
        { method: "post", op: pathItem.post },
        { method: "put", op: pathItem.put },
        { method: "delete", op: pathItem.delete },
        { method: "patch", op: pathItem.patch },
      ].filter((x): x is { method: string; op: Operation } => !!x.op);

      for (const { method, op } of operations) {
        const operationId = op.operationId || `${method}${path.replace(/[^a-zA-Z0-9]/g, "_")}`;
        const methodName = toMethodName(operationId);
        const tsPath = path.replace(/{(\w+)}/g, "${$1}");
        const pathParams = [...path.matchAll(/{(\w+)}/g)].map((m) => m[1]);

        // Build function signature
        const params: string[] = [];

        // Path parameters
        for (const param of pathParams) {
          params.push(`${param}: string`);
        }

        // Body parameter
        if (op.requestBody?.content?.["application/json"]?.schema) {
          const bodyType = generateTypeFromSchema(
            op.requestBody.content["application/json"].schema,
            spec.components?.schemas || {},
            0
          );
          params.push(`body: ${bodyType}`);
        }

        // Query parameters
        const queryParams = op.parameters?.filter((p) => p.in === "query") || [];
        if (queryParams.length > 0) {
          const queryType = queryParams
            .map((p) => `${p.name}${p.required ? "" : "?"}: string`)
            .join("; ");
          params.push(`query?: { ${queryType} }`);
        }

        // Return type
        let returnType = "Promise<void>";
        for (const [code, response] of Object.entries(op.responses || {})) {
          if (code.startsWith("2") && response.content?.["application/json"]?.schema) {
            returnType = `Promise<${generateTypeFromSchema(
              response.content["application/json"].schema,
              spec.components?.schemas || {},
              0
            )}>`;
            break;
          }
        }

        // Generate method
        parts.push("");
        parts.push("  /**");
        if (op.summary) parts.push(`   * ${op.summary}`);
        if (op.description) parts.push(`   * ${op.description}`);
        parts.push("   */");
        parts.push(`  async ${methodName}(${params.join(", ")}): ${returnType} {`);

        // Build request call
        const requestPath = pathParams.length > 0 ? `\`${tsPath}\`` : `"${path}"`;
        const requestOptions: string[] = [];

        if (op.requestBody?.content?.["application/json"]?.schema) {
          requestOptions.push("body");
        }

        if (queryParams.length > 0) {
          requestOptions.push("params: query");
        }

        const optionsStr = requestOptions.length > 0 ? `, { ${requestOptions.join(", ")} }` : "";
        const returnTypeGeneric = returnType.replace("Promise<", "").replace(">", "");
        parts.push(`    return this.request<${returnTypeGeneric}>("${method.toUpperCase()}", ${requestPath}${optionsStr});`);
        parts.push("  }");
      }
    }
  }

  parts.push("}");
  return parts.join("\n");
}

/**
 * Convert operationId to method name
 */
function toMethodName(operationId: string): string {
  return operationId
    .replace(/[^a-zA-Z0-9]/g, "_")
    .split("_")
    .map((part, i) => (i === 0 ? part.toLowerCase() : part.charAt(0).toUpperCase() + part.slice(1).toLowerCase()))
    .join("");
}

/**
 * Generate index.ts content
 */
function generateIndex(): string {
  return `/**
 * Bonfire SDK
 *
 * TypeScript SDK for interacting with the Bonfire API.
 * Auto-generated from OpenAPI specification.
 */

export { BonfireClient, type ClientConfig } from "./client";
export * from "./types";

export const SDK_VERSION = "0.0.1";
`;
}

/**
 * Generate SDK files from OpenAPI spec
 */
async function generateSDK(spec: OpenAPISpec): Promise<void> {
  console.log("Generating TypeScript SDK...\n");

  // Ensure output directory exists
  mkdirSync(SDK_OUTPUT_DIR, { recursive: true });

  // Generate types.ts
  const typesContent = generateTypes(spec);
  const typesPath = join(SDK_OUTPUT_DIR, "types.ts");
  writeFileSync(typesPath, typesContent);
  console.log(`✅ Generated types.ts`);

  // Generate client.ts
  const clientContent = generateClient(spec);
  const clientPath = join(SDK_OUTPUT_DIR, "client.ts");
  writeFileSync(clientPath, clientContent);
  console.log(`✅ Generated client.ts`);

  // Generate index.ts
  const indexContent = generateIndex();
  const indexPath = join(SDK_OUTPUT_DIR, "index.ts");
  writeFileSync(indexPath, indexContent);
  console.log(`✅ Generated index.ts`);

  console.log("\n✨ SDK generation complete!");
  console.log(`\nOutput directory: ${SDK_OUTPUT_DIR}`);
  console.log("\nTo use the SDK:");
  console.log('  import { BonfireClient } from "@bonfire/sdk";');
  console.log('  const client = new BonfireClient({ baseUrl: "http://localhost:3000" });');
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  console.log("=== Bonfire SDK Generator ===\n");

  const args = parseArgs();
  const spec = await fetchOpenAPISpec(args.local);
  await generateSDK(spec);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
