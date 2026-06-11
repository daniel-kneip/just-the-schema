import { EmitContext, emitFile, resolvePath } from "@typespec/compiler";
import { emitSchemas } from "./emitter.js";

export { $decorators } from "./decorators.js";
export { emitSchemas } from "./emitter.js";
export { $lib } from "./lib.js";

export async function $onEmit(context: EmitContext): Promise<void> {
  if (context.program.compilerOptions.noEmit) return;
  await emitFile(context.program, {
    path: resolvePath(context.emitterOutputDir, "schemas.ts"),
    content: emitSchemas(context.program),
  });
}
