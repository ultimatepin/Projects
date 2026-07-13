const updateBaseUrl = process.env.UPDATE_BASE_URL?.replace(/\/$/, '')

module.exports = {
  appId: 'com.ultimatepin.riftlocal',
  productName: 'Rift Local',
  asar: true,
  directories: {
    output: 'release',
    buildResources: 'build',
  },
  files: [
    'dist/**',
    'electron/**',
    'server/**',
    'package.json',
  ],
  publish: updateBaseUrl
    ? [{ provider: 'generic', url: `${updateBaseUrl}/win/x64`, channel: 'latest' }]
    : [{ provider: 'github', owner: 'ultimatepin', repo: 'Projects', releaseType: 'release' }],
  win: {
    icon: 'build/icon.ico',
    target: [{ target: 'nsis', arch: ['x64'] }],
    artifactName: 'Rift-Local-Setup-${version}-${arch}.${ext}',
    electronUpdaterCompatibility: '>= 2.16',
    verifyUpdateCodeSignature: true,
    forceCodeSigning: process.env.RELEASE === 'true',
  },
  nsis: {
    oneClick: true,
    perMachine: false,
    runAfterFinish: true,
    createDesktopShortcut: true,
    createStartMenuShortcut: true,
    deleteAppDataOnUninstall: false,
  },
}
