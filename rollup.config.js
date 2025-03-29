import resolve from "@rollup/plugin-node-resolve";
import commonjs from "@rollup/plugin-commonjs";
import json from "@rollup/plugin-json";
import fs from "fs";
import path from "path";

// Copy required files from gpt-3-encoder to dist folder
const copyEncoderFiles = {
  name: "copy-encoder-files",
  buildEnd() {
    try {
      // Create dist folder if it doesn't exist
      if (!fs.existsSync("dist")) {
        fs.mkdirSync("dist", { recursive: true });
      }

      // Copy encoder.json
      const encoderPath = require.resolve("gpt-3-encoder/encoder.json");
      fs.copyFileSync(encoderPath, "dist/encoder.json");

      // Copy vocab.bpe
      const vocabPath = require.resolve("gpt-3-encoder/vocab.bpe");
      fs.copyFileSync(vocabPath, "dist/vocab.bpe");

      console.log("Successfully copied encoder files to dist folder");
    } catch (error) {
      console.error("Failed to copy encoder files:", error);
    }
  },
};

export default {
  input: "src/index.mjs",
  output: [
    {
      file: "dist/index.mjs",
      format: "es",
      banner: "#!/usr/bin/env node",
    },
    {
      file: "dist/index.cjs",
      format: "cjs",
      banner: "#!/usr/bin/env node",
    },
  ],
  plugins: [
    resolve({
      preferBuiltins: true,
      extensions: [".mjs", ".js", ".json", ".node"],
      moduleDirectories: ["node_modules"],
    }),
    commonjs(),
    json(),
    // Add a plugin to replace __dirname in ES modules
    {
      name: "replace-dirname",
      transform(code) {
        // Only process code that contains __dirname references from gpt-3-encoder
        if (
          code.includes("__dirname") &&
          (code.includes("encoder.json") || code.includes("vocab.bpe"))
        ) {
          // Replace specific __dirname references with hardcoded paths to the copied files
          let modifiedCode = code.replace(
            /path\.join\(__dirname, ['"]\.\/encoder\.json['"]\)/g,
            "path.join(process.cwd(), 'dist/encoder.json')"
          );

          modifiedCode = modifiedCode.replace(
            /path\.join\(__dirname, ['"]\.\/vocab\.bpe['"]\)/g,
            "path.join(process.cwd(), 'dist/vocab.bpe')"
          );

          return modifiedCode;
        }
        return null;
      },
    },
    copyEncoderFiles,
  ],
  external: ["fs", "path", "child_process"],
};
