/** @type {import('@bacons/apple-targets/app.plugin').ConfigFunction} */
module.exports = (config) => ({
  type: 'broadcast-upload',
  name: 'HE2Capture',
  displayName: 'HE2 Game Capture',
  bundleIdentifier: '.broadcast',
  deploymentTarget: '15.1',
  frameworks: ['ReplayKit', 'Vision', 'Accelerate'],
  entitlements: {
    'com.apple.security.application-groups':
      config.ios.entitlements['com.apple.security.application-groups'],
  },
});
