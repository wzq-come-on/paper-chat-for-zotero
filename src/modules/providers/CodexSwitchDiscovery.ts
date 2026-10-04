import { getPref } from "../../utils/prefs";

export interface CodexSwitchInstallation {
  root: string;
  executable?: string;
  clientVersion?: string;
}

export interface SwitchDiscoveryIO {
  platform: "windows" | "macos" | "linux";
  env: Record<string, string>;
  join(...parts: string[]): string;
  exists(path: string): Promise<boolean>;
  readJSON(path: string): Promise<unknown>;
  getChildren(path: string): Promise<string[]>;
}

function object(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function version(value: unknown): string | undefined {
  return typeof value === "string" && /^\d+\.\d+\.\d+$/.test(value)
    ? value
    : undefined;
}

function parent(path: string): string {
  return path.replace(/[\\/][^\\/]+[\\/]*$/, "");
}

function filename(path: string): string {
  return path.split(/[\\/]/).pop() || "";
}

async function readObject(
  io: SwitchDiscoveryIO,
  path: string,
): Promise<Record<string, unknown>> {
  try {
    return object(await io.readJSON(path));
  } catch {
    return {};
  }
}

function defaultRoots(io: SwitchDiscoveryIO): string[] {
  const { env, join } = io;
  if (io.platform === "windows") {
    return env.APPDATA ? [join(env.APPDATA, "dev.codex.switch")] : [];
  }
  if (io.platform === "macos") {
    return env.HOME
      ? [join(env.HOME, "Library", "Application Support", "dev.codex.switch")]
      : [];
  }
  const dataHome =
    env.XDG_DATA_HOME || (env.HOME ? join(env.HOME, ".local", "share") : "");
  return dataHome ? [join(dataHome, "dev.codex.switch")] : [];
}

/** Read installation metadata only; never open account/auth files or run an exe. */
export async function discoverCodexSwitchInstallation(
  explicitRoot = "",
  suppliedIO?: SwitchDiscoveryIO,
): Promise<CodexSwitchInstallation | null> {
  try {
    let io = suppliedIO;
    if (!io) {
      const { Subprocess } = ChromeUtils.importESModule(
        "resource://gre/modules/Subprocess.sys.mjs",
      ) as { Subprocess: { getEnvironment(): Record<string, string> } };
      io = {
        platform: Zotero.isWin ? "windows" : Zotero.isMac ? "macos" : "linux",
        env: Subprocess.getEnvironment(),
        join: (...parts) => PathUtils.join(...parts),
        exists: (path) => IOUtils.exists(path),
        readJSON: (path) => IOUtils.readJSON(path),
        getChildren: (path) => IOUtils.getChildren(path),
      };
    }
    const roots = explicitRoot.trim()
      ? [explicitRoot.trim()]
      : defaultRoots(io);
    for (const root of roots) {
      if (!(await io.exists(io.join(root, "settings.json")))) continue;
      const installation: CodexSwitchInstallation = { root };
      const executableName = io.platform === "windows" ? "codex.exe" : "codex";
      const state = await readObject(io, io.join(root, "state.json"));
      const activePath = state.local_codex_path;
      // Switch may store the Desktop app here. Never treat ChatGPT.exe as a CLI.
      if (
        typeof activePath === "string" &&
        filename(activePath).toLowerCase() === executableName &&
        (await io.exists(activePath))
      ) {
        const packageRoot = parent(parent(activePath));
        const metadata = await readObject(
          io,
          io.join(packageRoot, "codex-package.json"),
        );
        return {
          ...installation,
          executable: activePath,
          clientVersion:
            version(metadata.version) || version(filename(packageRoot)),
        };
      }
      let directories: string[];
      try {
        directories = await io.getChildren(io.join(root, "codex-cli"));
      } catch {
        return installation;
      }
      directories = directories.filter((path) => version(filename(path)));
      directories.sort((a, b) =>
        filename(b).localeCompare(filename(a), "en", { numeric: true }),
      );
      for (const directory of directories) {
        const executable = io.join(directory, "bin", executableName);
        if (!(await io.exists(executable))) continue;
        const metadata = await readObject(
          io,
          io.join(directory, "codex-package.json"),
        );
        return {
          ...installation,
          executable,
          clientVersion:
            version(metadata.version) || version(filename(directory)),
        };
      }
      return installation;
    }
  } catch {
    // Discovery is optional. A missing or unreadable Switch must not break chat.
  }
  return null;
}

export function getConfiguredSwitchRoot(): string {
  try {
    return String(getPref("speechCodexSwitchRoot") || "").trim();
  } catch {
    return "";
  }
}
