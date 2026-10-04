import { strict as assert } from "node:assert";
import { posix } from "node:path";
import {
  discoverCodexSwitchInstallation,
  type SwitchDiscoveryIO,
} from "../src/modules/providers/CodexSwitchDiscovery.ts";
import {
  CODEX_CLIENT_VERSION,
  usesAutomaticCodexVersion,
} from "../src/modules/providers/CodexSwitchProvider.ts";
import type { ApiKeyProviderConfig } from "../src/types/provider.ts";

function fixture(platform: SwitchDiscoveryIO["platform"] = "windows") {
  const env = { APPDATA: "/roaming", HOME: "/home/researcher" };
  const root =
    platform === "windows"
      ? "/roaming/dev.codex.switch"
      : platform === "macos"
        ? "/home/researcher/Library/Application Support/dev.codex.switch"
        : "/home/researcher/.local/share/dev.codex.switch";
  const files = new Map<string, unknown>([[`${root}/settings.json`, {}]]);
  const reads: string[] = [];
  const io: SwitchDiscoveryIO = {
    platform,
    env,
    join: posix.join,
    exists: async (path) => files.has(path),
    readJSON: async (path) => {
      reads.push(path);
      if (!files.has(path)) throw new Error("missing");
      return files.get(path);
    },
    getChildren: async (path) => [
      ...new Set(
        [...files.keys()]
          .filter((file) => file.startsWith(path + "/"))
          .map(
            (file) => path + "/" + file.slice(path.length + 1).split("/")[0],
          ),
      ),
    ],
  };
  const install = (
    v: string,
    metadata: unknown = { version: v },
    complete = true,
  ) => {
    const folder = `${root}/codex-cli/${v}`;
    if (complete)
      files.set(
        `${folder}/bin/${platform === "windows" ? "codex.exe" : "codex"}`,
        {},
      );
    files.set(`${folder}/codex-package.json`, metadata);
  };
  return { io, root, files, reads, install };
}

describe("Codex Switch installation discovery", function () {
  for (const platform of ["windows", "macos", "linux"] as const) {
    it(`detects the ${platform} data directory and numeric newest installed CLI`, async function () {
      const f = fixture(platform);
      f.install("0.9.0");
      f.install("0.160.0");
      f.install("0.159.1");
      f.install("0.161.0", undefined, false);
      f.install("unfinished-download");
      const result = await discoverCodexSwitchInstallation("", f.io);
      assert.equal(result?.root, f.root);
      assert.equal(result?.clientVersion, "0.160.0");
      assert.match(result?.executable || "", /0\.160\.0\/bin\/codex/);
    });
  }

  it("uses the configured active CLI instead of a newer unused download", async function () {
    const f = fixture();
    f.install("0.159.1");
    f.install("0.160.0");
    const executable = `${f.root}/codex-cli/0.159.1/bin/codex.exe`;
    f.files.set(`${f.root}/state.json`, { local_codex_path: executable });
    const result = await discoverCodexSwitchInstallation("", f.io);
    assert.equal(result?.executable, executable);
    assert.equal(result?.clientVersion, "0.159.1");
  });

  it("ignores a Desktop app path and never reads account files", async function () {
    const f = fixture();
    f.install("0.160.0");
    f.files.set("/Desktop/ChatGPT.exe", {});
    f.files.set(`${f.root}/state.json`, {
      local_codex_path: "/Desktop/ChatGPT.exe",
      authToken: "private",
    });
    const result = await discoverCodexSwitchInstallation("", f.io);
    assert.equal(result?.clientVersion, "0.160.0");
    assert(
      f.reads.every((path) => /\/(state|codex-package)\.json$/.test(path)),
    );
    assert(!JSON.stringify(result).includes("private"));
  });

  it("respects a custom directory and does not silently switch when it is missing", async function () {
    const f = fixture();
    f.install("0.160.0");
    assert.equal(await discoverCodexSwitchInstallation("/missing", f.io), null);
    f.files.set("/custom/settings.json", {});
    f.files.set("/custom/codex-cli/0.158.0/bin/codex.exe", {});
    assert.equal(
      (await discoverCodexSwitchInstallation("/custom", f.io))?.clientVersion,
      "0.158.0",
    );
  });

  it("supports the Linux XDG data directory override", async function () {
    const f = fixture("linux");
    f.io.env.XDG_DATA_HOME = "/data";
    f.files.set("/data/dev.codex.switch/settings.json", {});
    assert.equal(
      (await discoverCodexSwitchInstallation("", f.io))?.root,
      "/data/dev.codex.switch",
    );
  });

  it("uses the installation folder if the version metadata is corrupt", async function () {
    const f = fixture();
    f.install("0.160.0", { version: { token: "private" } });
    assert.equal(
      (await discoverCodexSwitchInstallation("", f.io))?.clientVersion,
      "0.160.0",
    );
  });

  it("keeps a detected root without CLI and tolerates denied filesystem reads", async function () {
    const f = fixture();
    assert.deepEqual(await discoverCodexSwitchInstallation("", f.io), {
      root: f.root,
    });
    f.io.exists = async () => {
      throw new Error("denied");
    };
    assert.equal(await discoverCodexSwitchInstallation("", f.io), null);
  });

  it("upgrades the old default while preserving manual and remote-version overrides", function () {
    const config = (fields: Partial<ApiKeyProviderConfig>) =>
      fields as ApiKeyProviderConfig;
    assert(
      usesAutomaticCodexVersion(
        config({ clientVersion: CODEX_CLIENT_VERSION }),
      ),
    );
    assert(
      usesAutomaticCodexVersion(
        config({ clientVersionMode: "auto", clientVersion: "0.160.0" }),
      ),
    );
    assert(!usesAutomaticCodexVersion(config({ clientVersion: "0.158.0" })));
    assert(
      !usesAutomaticCodexVersion(
        config({
          clientVersionMode: "manual",
          clientVersion: CODEX_CLIENT_VERSION,
        }),
      ),
    );
  });
});
