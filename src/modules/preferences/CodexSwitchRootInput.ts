import { getPref, setPref } from "../../utils/prefs";
import { discoverCodexSwitchInstallation } from "../providers/CodexSwitchDiscovery";

/** Display the automatic path without turning it into a persistent override. */
export async function autofillSwitchRootInput(
  input: HTMLInputElement,
): Promise<void> {
  if (String(getPref("speechCodexSwitchRoot") || "").trim()) return;
  const previousValue = input.value;
  const installation = await discoverCodexSwitchInstallation();
  if (
    !installation ||
    input.value !== previousValue ||
    String(getPref("speechCodexSwitchRoot") || "").trim()
  )
    return;
  input.value = installation.root;
  input.dataset.detectedRoot = installation.root;
}

export function persistSwitchRootInput(input: HTMLInputElement): void {
  const value = input.value.trim();
  setPref(
    "speechCodexSwitchRoot",
    value === input.dataset.detectedRoot ? "" : value,
  );
  if (!value) void autofillSwitchRootInput(input).catch(() => {});
}
