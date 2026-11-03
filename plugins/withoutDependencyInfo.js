// Drops the dependency metadata block that AGP signs into the APK with a Google key.
// IzzyOnDroid and F-Droid flag it because only Google can read it.
const { withAppBuildGradle } = require('expo/config-plugins');

module.exports = function withoutDependencyInfo(config) {
  return withAppBuildGradle(config, (config) => {
    if (!config.modResults.contents.includes('dependenciesInfo')) {
      config.modResults.contents = config.modResults.contents.replace(
        /^android \{$/m,
        'android {\n    dependenciesInfo {\n        includeInApk = false\n        includeInBundle = false\n    }',
      );
    }
    return config;
  });
};
