import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { program } from "commander";
import ignore from "ignore";
import slugify from "slugify";
import { encode } from "gpt-3-encoder"; // Add this import for token estimation
import { allowedExtensions } from "./allowed-extensions.mjs";
import { fileURLToPath } from "url";

// Replace __dirname with a derived directory path
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DEBUG = process.env.DEBUG === "true";

function log(...args) {
  if (DEBUG) {
    console.log(...args);
  }
}

// Replace tempy.temporaryDirectory with a custom implementation
function createTemporaryDirectory() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "better-repo-to-llm-"));
  return tempDir;
}

program
  .argument("<gitUrl>", "Git repository URL (HTTPS or SSH)")
  .option("--exclude <patterns...>", "Additional patterns to exclude")
  .option("--minify", "Minify code files by removing whitespace and new lines")
  .option("--max-lines <number>", "Maximum number of lines per file", parseInt)
  .parse(process.argv);

const gitUrl = program.args[0];
const additionalExcludes = program.opts().exclude || [];
const shouldMinify = program.opts().minify;
const maxLines = program.opts().maxLines || 800; // Use the provided value or default to 800

const tempDir = createTemporaryDirectory();

const MAX_FILE_LINES = 800; // New constant for maximum file lines
let output = "";
let excludedFiles = []; // New array to store excluded files
let includedFiles = []; // New array to store included files

try {
  // Clone the repository
  execSync(`git clone ${gitUrl} ${tempDir}`, {
    stdio: DEBUG ? "inherit" : "ignore",
  });

  // Read .gitignore and create ignore instance
  const gitignorePath = path.join(tempDir, ".gitignore");
  const ig = ignore();
  if (fs.existsSync(gitignorePath)) {
    ig.add(fs.readFileSync(gitignorePath, "utf8"));
  }
  ig.add([
    "package-lock.json",
    "yarn.lock",
    ".*",
    "LICENSE*",
    "*.ico",
    "*.log",
    ...additionalExcludes,
  ]);

  // Walk through the repository
  function walkDir(dir) {
    log(`Walking directory: ${dir}`);
    const files = fs.readdirSync(dir);
    for (const file of files) {
      const filePath = path.join(dir, file);
      const stat = fs.statSync(filePath);
      const relativePath = path.relative(tempDir, filePath);

      if (stat.isDirectory()) {
        log(`Found directory: ${relativePath}`);
        if (!ig.ignores(relativePath)) {
          walkDir(filePath);
        } else {
          log(`Directory ignored: ${relativePath}`);
        }
      } else if (stat.isFile()) {
        log(`Checking file: ${relativePath}`);
        if (!ig.ignores(relativePath)) {
          log(`File not ignored: ${relativePath}`);
          const extension = path.extname(filePath).toLowerCase();

          if (allowedExtensions.includes(extension)) {
            const content = fs.readFileSync(filePath, "utf8");
            const minifiedContent = minifyContent(content, extension);
            const lines = minifiedContent.split("\n");

            if (lines.length <= maxLines) {
              const filename = path.basename(file);
              const fileSize = fs.statSync(filePath).size;
              const tokenCount = encode(minifiedContent).length;

              output += `\n<File name="${filename}" path="${relativePath}" size="${fileSize}" tokens="${tokenCount}">\n${minifiedContent}\n</File name="${filename}">\n`;
              includedFiles.push({
                path: relativePath,
                size: fileSize,
                tokens: tokenCount,
              });
              log(
                `File included${
                  shouldMinify ? " and minified" : ""
                }: ${relativePath} (${fileSize} bytes, ${tokenCount} tokens)`
              );
            } else {
              excludedFiles.push({
                path: relativePath,
                lineCount: lines.length,
              });
              log(`File excluded (exceeds ${maxLines} lines): ${relativePath}`);
            }
          } else {
            log(`File skipped (not an allowed extension): ${relativePath}`);
          }
        } else {
          log(`File ignored: ${relativePath}`);
        }
      }
    }
  }

  walkDir(tempDir);

  // Generate output file name
  const repoName = path.basename(gitUrl, ".git");
  const outputFileName = `${slugify(repoName)}.txt`;

  // Write output to file
  fs.writeFileSync(outputFileName, output.trim());
  console.log(`Output written to ${outputFileName}`);

  // Calculate total file size and estimated tokens
  const totalFileSize = fs.statSync(outputFileName).size;
  const totalTokens = encode(output.trim()).length;

  // Output final summary
  console.log("\nFinal Output:");
  console.log(`File output: ${outputFileName}`);
  console.log(`FileSize: ${(totalFileSize / 1024).toFixed(2)}kb`);
  console.log(`Estimate Tokens: ${totalTokens}`);

  if (DEBUG) {
    // Output list of included files
    console.log("\nFiles included in the output:");
    includedFiles.forEach((file) => {
      console.log(`${file.path} (${file.size} bytes, ${file.tokens} tokens)`);
    });

    // Output list of excluded files
    if (excludedFiles.length > 0) {
      console.log("\nFiles excluded due to exceeding maximum line count:");
      excludedFiles.forEach((file) => {
        console.log(`${file.path} (${file.lineCount} lines)`);
      });
    } else {
      console.log("\nNo files excluded");
    }
  }
} catch (error) {
  console.error("An error occurred:", error.message);
  process.exit(1);
} finally {
  // Clean up temporary directory
  fs.rmSync(tempDir, { recursive: true, force: true });
}

function minifyContent(content, extension) {
  if (!shouldMinify) return content;

  const nonMinifiableExtensions = [".md", ".markdown", ".txt", ".rst"];
  if (nonMinifiableExtensions.includes(extension)) return content;

  // Basic minification: remove extra whitespace and newlines
  return content.replace(/\s+/g, " ").trim();
}
