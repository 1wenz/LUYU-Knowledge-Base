// Desktop uses pg's JavaScript driver. Preserve its optional-driver fallback
// while keeping the bundle independent of native addons and node_modules.
throw Object.assign(new Error("Native PostgreSQL driver is not included."), {
  code: "MODULE_NOT_FOUND",
});
export {};
