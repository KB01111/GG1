const { productName, appId, version, main } = require('./package.json');

const fileName = productName.replace(/\s/g, '');

module.exports = {
  appId,
  productName,
  buildVersion: version,
  directories: {
    output: 'dist'
  },
  files: [
    'dist/**',
    'package.json',
    'assets/**'
  ],
  extraMetadata: {
    main
  },
  win: {
    target: ['nsis', 'portable']
  },
  nsis: {
    artifactName: `${fileName}-v\${version}-Windows-setup.\${ext}`
  },
  portable: {
    artifactName: `${fileName}-v\${version}-Windows-portable.\${ext}`
  },
  mac: {
    target: 'dmg',
    darkModeSupport: true
  },
  dmg: {
    artifactName: `${fileName}-v\${version}-MacOS-\${arch}.\${ext}`
  },
  linux: {
    target: ['AppImage'],
    category: 'Utility'
  },
  appImage: {
    artifactName: `${fileName}-v\${version}-Linux.\${ext}`
  }
};
