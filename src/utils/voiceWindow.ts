/** DOM constructors must come from a real window. Zotero loads production
 * plugins into a script sandbox that does not expose every Web API global. */
export function getVoiceWindow(): Window & typeof globalThis {
  return Zotero.getMainWindow() as unknown as Window & typeof globalThis;
}
