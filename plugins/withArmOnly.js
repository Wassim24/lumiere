// Ships ARM builds only, with compressed native libs, to keep the APK under
// IzzyOnDroid's 30 MB limit (all four ABIs uncompressed weigh 84 MB). x86 is for emulators.
const { withGradleProperties } = require('expo/config-plugins');

const PROPS = {
  reactNativeArchitectures: 'armeabi-v7a,arm64-v8a',
  'expo.useLegacyPackaging': 'true',
};

module.exports = function withArmOnly(config) {
  return withGradleProperties(config, (config) => {
    for (const [key, value] of Object.entries(PROPS)) {
      const item = config.modResults.find((p) => p.type === 'property' && p.key === key);
      if (item) item.value = value;
      else config.modResults.push({ type: 'property', key, value });
    }
    return config;
  });
};
