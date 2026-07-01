import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const localPropertiesPath = join(
  repoRoot,
  "src-tauri",
  "gen",
  "android",
  "local.properties",
);

function unescapePropertyValue(value) {
  return value
    .replace(/\\:/g, ":")
    .replace(/\\=/g, "=")
    .replace(/\\\\/g, "\\")
    .replace(/\\ /g, " ");
}

function readLocalProperties(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  const properties = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const separator = trimmed.indexOf("=");
    if (separator === -1) {
      continue;
    }

    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    properties[key] = unescapePropertyValue(value);
  }
  return properties;
}

function firstValue(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function prependPath(env, paths) {
  const existing = env.Path || env.PATH || "";
  const additions = paths.filter((path) => path && existsSync(path));
  env.Path = [...additions, existing].filter(Boolean).join(delimiter);
  env.PATH = env.Path;
}

const localProperties = readLocalProperties(localPropertiesPath);
const androidHome = firstValue(
  localProperties["tauri.android.home"],
  localProperties["sdk.dir"],
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  "C:\\Users\\caozhen\\AppData\\Local\\Android\\Sdk",
);
const ndkHome = firstValue(
  localProperties["tauri.ndk.home"],
  process.env.NDK_HOME,
  process.env.ANDROID_NDK_HOME,
  join(androidHome, "ndk", "30.0.14904198"),
);
const javaHome = firstValue(
  localProperties["tauri.java.home"],
  process.env.JAVA_HOME,
  "C:\\Program Files\\Android\\Android Studio\\jbr",
);
const cargoDir = firstValue(
  localProperties["tauri.cargo.dir"],
  "C:\\Users\\caozhen\\.cargo\\bin",
);
const nodeDir = firstValue(localProperties["tauri.node.dir"]);

const env = { ...process.env };
env.JAVA_HOME = javaHome;
env.ANDROID_HOME = androidHome;
env.ANDROID_SDK_ROOT = androidHome;
env.NDK_HOME = ndkHome;
env.ANDROID_NDK_HOME = ndkHome;
env.GRADLE_USER_HOME = firstValue(env.GRADLE_USER_HOME, join(repoRoot, ".gradle"));

prependPath(env, [
  join(javaHome, "bin"),
  join(androidHome, "platform-tools"),
  join(androidHome, "emulator"),
  join(ndkHome, "toolchains", "llvm", "prebuilt", "windows-x86_64", "bin"),
  cargoDir,
  nodeDir,
]);

const tauriBin = join(
  repoRoot,
  "node_modules",
  ".bin",
  process.platform === "win32" ? "tauri.cmd" : "tauri",
);

const result = spawnSync(tauriBin, process.argv.slice(2), {
  cwd: repoRoot,
  env,
  shell: process.platform === "win32",
  stdio: "inherit",
});

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}

process.exit(result.status ?? 1);
