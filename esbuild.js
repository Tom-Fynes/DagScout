// esbuild.js
const esbuild = require("esbuild");
const path = require("path");
const args = process.argv.slice(2);
const watch = args.includes("--watch");
const production = args.includes("--production");

async function main() {
  const buildOptions = {
    entryPoints: ["./src/extension.ts"],
    bundle: true,
    platform: "node",
    target: ["node16"],
    outfile: path.join("dist", "extension.js"),
    sourcemap: true,
    minify: production,
    external: ["vscode"],
  };

  if (watch) {
    const ctx = await esbuild.context(buildOptions);
    await ctx.watch();
  } else {
    await esbuild.build(buildOptions);
  }
}

main().catch(() => process.exit(1));
