// Karma config for parallel `ng test` runs. When karmaConfig is set in
// angular.json, @angular/build:karma uses an empty base instead of its
// built-in defaults, so we must reproduce the required framework/plugin
// setup here. scripts/verify.sh passes a per-run KARMA_PORT; everything
// else mirrors the @angular/build:karma defaults.
module.exports = function (config) {
  config.set({
    basePath: '',
    frameworks: ['jasmine'],
    plugins: [
      require('karma-jasmine'),
      require('karma-chrome-launcher'),
      require('karma-jasmine-html-reporter'),
      require('karma-coverage'),
    ],
    jasmineHtmlReporter: {
      suppressAll: true,
    },
    coverageReporter: {
      dir: require('path').join(__dirname, 'coverage/plnd_client'),
      subdir: '.',
      reporters: [{ type: 'html' }, { type: 'text-summary' }],
    },
    reporters: ['progress', 'kjhtml'],
    browsers: ['Chrome'],
    customLaunchers: {
      ChromeHeadlessNoSandbox: {
        base: 'ChromeHeadless',
        flags: ['--no-sandbox', '--headless', '--disable-gpu', '--disable-dev-shm-usage'],
      },
    },
    restartOnFileChange: true,
    port: process.env['KARMA_PORT'] ? Number(process.env['KARMA_PORT']) : 9876,
  });
};
