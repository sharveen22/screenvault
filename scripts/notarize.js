const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  const { electronPlatformName, appOutDir } = context;
  if (electronPlatformName !== 'darwin') return;

  console.log('Skipping notarization for local build');
  return;

  /*
  const appName = context.packager.appInfo.productFilename;

  return await notarize({
    appBundleId: 'com.screenvault.app.taufiq',
    appPath: `${appOutDir}/${appName}.app`,
    appleId: "---email---",
    appleIdPassword: "---app specific password---",
    teamId: "---team id---",
  });
  */
};