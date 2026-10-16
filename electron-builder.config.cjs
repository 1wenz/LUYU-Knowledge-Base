const pkg = require("./package.json");
const metadata = require("./.cache/public-metadata.json");

module.exports = {
  ...pkg.build,
  copyright: metadata.copyright ?? "开发者未配置",
  extraMetadata: {
    author: { name: metadata.name ?? "未配置" },
    homepage: metadata.homepage ?? "",
    license: metadata.license,
  },
  win: {
    ...pkg.build.win,
    icon: ".cache/branding/app.ico",
    target: [{ target: "nsis", arch: ["x64"] }],
  },
  nsis: {
    installerIcon: ".cache/branding/app.ico",
    uninstallerIcon: ".cache/branding/app.ico",
    artifactName: "Zhiyu-${version}-win-${arch}.${ext}",
    oneClick: false,
    allowToChangeInstallationDirectory: true,
  },
};
