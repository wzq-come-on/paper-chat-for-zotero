import { assert } from "chai";

const addonId = "paper-chat@zotero.plugin";
const pref = "extensions.zotero.paperchat.installProbe";
const { AddonManager } = ChromeUtils.importESModule(
  "resource://gre/modules/AddonManager.sys.mjs",
) as any;

function xpi(name: string) {
  const file = Components.classes["@mozilla.org/file/local;1"].createInstance(
    Components.interfaces.nsIFile,
  );
  file.initWithPath(Zotero.Prefs.get(`${pref}${name}Xpi`, true) as string);
  return file;
}

describe("Packaged XPI installation in Zotero", function () {
  it("rejects an XPI missing Zotero's required update_url", async function () {
    const install = await AddonManager.getInstallForFile(xpi("Old"));
    assert.equal(install.error, AddonManager.ERROR_CORRUPT_FILE);
    assert.equal(install.state, AddonManager.STATE_DOWNLOAD_FAILED);
  });

  it("accepts the same release when only update_url is restored", async function () {
    const install = await AddonManager.getInstallForFile(xpi("Restored"));
    assert.equal(install.error, 0);
    assert.equal(install.addon.id, addonId);
    assert.isTrue(install.addon.isCompatible);
    install.cancel();
  });

  it("permanently installs and starts the exact fixed release XPI", async function () {
    let stage = "uninstall temporary development add-on";
    try {
      const developmentInstance = (Zotero as any).PaperChat;
      const temporary = await AddonManager.getAddonByID(addonId);
      assert.exists(temporary);
      await temporary.uninstall();
      stage = "parse release XPI";
      const install = await AddonManager.getInstallForFile(xpi("New"));
      assert.equal(install.error, 0);
      assert.isTrue(install.addon.isCompatible);
      assert.isFalse(install.addon.appDisabled);
      stage = "install release XPI";
      const installed: any = await new Promise((resolve, reject) => {
        const listener = {
          onInstallEnded(_install: any, addon: any) {
            install.removeListener(listener);
            resolve(addon);
          },
          onInstallFailed(failed: any) {
            install.removeListener(listener);
            reject(new Error(`Installation failed: ${failed.error}`));
          },
        };
        install.addListener(listener);
        install.install();
      });
      stage = "verify installed add-on";
      assert.equal(installed.id, addonId);
      assert.equal(installed.version, "3.7.2");
      assert.isFalse(installed.temporarilyInstalled);
      assert.isTrue(installed.isActive);
      const manifest = JSON.parse(
        await (Zotero.File as any).getResourceAsync(
          installed.getResourceURI("manifest.json").spec,
        ),
      );
      assert.include(
        manifest.applications.zotero.update_url,
        "wzq-come-on/paper-chat-for-zotero",
      );
      stage = "verify installed plugin startup";
      for (let attempt = 0; attempt < 200; attempt++) {
        const addon = (Zotero as any).PaperChat;
        if (
          addon !== developmentInstance &&
          addon?.data.alive &&
          addon?.data.initialized
        )
          break;
        await Zotero.Promise.delay(100);
      }
      assert.notStrictEqual((Zotero as any).PaperChat, developmentInstance);
      assert.isTrue((Zotero as any).PaperChat.data.initialized);
      assert.equal((Zotero as any).PaperChat.data.env, "production");
      const win = Zotero.Utilities.Internal.openPreferences(
        "paperchat-prefpane",
      ) as any;
      try {
        let item: HTMLElement | null = null;
        for (let attempt = 0; attempt < 100; attempt++) {
          item = win.document.querySelector(
            '[data-provider-id="codex-switch"]',
          );
          if (item) break;
          await Zotero.Promise.delay(100);
        }
        assert.exists(
          item,
          "Installed release must expose the Codex Switch provider",
        );
        item!.click();
        assert.equal(
          win.document.getElementById("pref-provider-api-protocol").value,
          "codex-switch",
        );
      } finally {
        win.close();
      }
    } catch (error: any) {
      (window as any).debug({
        stage,
        message: String(error),
        stack: error?.stack,
      });
      throw new Error(`${String(error)}\n${error?.stack || ""}`);
    }
  });
});
