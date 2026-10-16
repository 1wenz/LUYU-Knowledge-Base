// Electron 44 retains this runtime inspector for automation but omits it from its public bindings.
// Keep the augmentation limited to the E2E TypeScript project; production code never calls it.
declare namespace Electron {
  interface WebContents {
    getLastWebPreferences(): WebPreferences;
  }
}
