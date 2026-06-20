import { EmitContext, resolvePath } from "@typespec/compiler";
import { TestHost, createTestHost } from "@typespec/compiler/testing";
import { describe, expect, it } from "vitest";
import { $onEmit } from "../src/index.js";

const OUTPUT_DIR = "/out";
const SCHEMAS = resolvePath(OUTPUT_DIR, "schemas.ts");

async function compile(
  code: string,
  options: Parameters<TestHost["compile"]>[1] = {},
): Promise<TestHost> {
  const host = await createTestHost();
  host.addTypeSpecFile("main.tsp", code);
  await host.compile("main.tsp", options);
  return host;
}

function emit(host: TestHost): Promise<void> {
  return $onEmit({
    program: host.program,
    emitterOutputDir: OUTPUT_DIR,
  } as unknown as EmitContext);
}

describe("$onEmit", () => {
  it("writes schemas.ts to the output directory", async () => {
    const host = await compile(`model Pet { name: string; }`);
    await emit(host);
    const file = host.fs.get(SCHEMAS);
    expect(file).toBeDefined();
    expect(file).toContain("export const Pet = z.object({");
  });

  it("emits nothing when noEmit is set", async () => {
    const host = await compile(`model Pet { name: string; }`, { noEmit: true });
    await emit(host);
    expect(host.fs.get(SCHEMAS)).toBeUndefined();
  });
});
