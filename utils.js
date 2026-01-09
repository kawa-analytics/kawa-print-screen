const fs = require('node:fs');
const { getActiveLogger } = require('./log');
const logger = getActiveLogger();

// https://github.com/puppeteer/puppeteer/issues/1353#issuecomment-648299486
function waitForNetworkIdle(
  page,
  {
    timeout = 180000,
    waitForFirstRequest = 1000,
    waitForLastRequest = 3000,
    maxInflightRequests = 0,
  },
) {
  let inflight = 0;
  let resolve;
  let reject;
  let firstRequestTimeoutId;
  let lastRequestTimeoutId;
  let timeoutId;
  maxInflightRequests = Math.max(maxInflightRequests, 0);

  function cleanup() {
    clearTimeout(timeoutId);
    clearTimeout(firstRequestTimeoutId);
    clearTimeout(lastRequestTimeoutId);

    page.removeListener('request', onRequestStarted);
    page.removeListener('requestfinished', onRequestFinished);
    page.removeListener('requestfailed', onRequestFinished);
  }

  function check() {
    if (inflight <= maxInflightRequests) {
      clearTimeout(lastRequestTimeoutId);
      lastRequestTimeoutId = setTimeout(onLastRequestTimeout, waitForLastRequest);
    }
  }

  function onRequestStarted(req) {
    //  logger.debug('onRequestStarted', req.url());
    clearTimeout(firstRequestTimeoutId);
    clearTimeout(lastRequestTimeoutId);
    inflight += 1;
  }

  function onRequestFinished(req) {
    // logger.debug('onRequestFinished', req.url());
    inflight -= 1;
    check();
  }

  function onRequestFailed(req) {
    // logger.debug('onRequestFailed', req.url());
    inflight -= 1;
    check();
  }

  function onTimeout() {
    cleanup();
    reject(new Error('Timeout'));
  }

  function onFirstRequestTimeout() {
    cleanup();
    resolve();
  }

  function onLastRequestTimeout() {
    cleanup();
    resolve();
  }

  page.on('request', onRequestStarted);
  page.on('requestfinished', onRequestFinished);
  page.on('requestfailed', onRequestFailed);

  // Overall page timeout
  timeoutId = setTimeout(onTimeout, timeout);
  firstRequestTimeoutId = setTimeout(onFirstRequestTimeout, waitForFirstRequest);

  return new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
}

let debugScreenshotCounter = 1;

function debugConsole(page) {
  page
    .on('console', (message) =>
      logger.debug(`${message.type().substr(0, 3).toUpperCase()} ${message.text()}`),
    )
    .on('pageerror', ({ message }) => logger.debug(message))
    .on('response', (response) => logger.debug(`${response.status()} ${response.url()}`))
    .on('requestfailed', (request) =>
      logger.debug(`${request.failure().errorText} ${request.url()}`),
    );
}

function takeDebugScreenshot(page, count = 1, interval = 0) {
  let runCounter = 0;

  const dir = '/tmp/debug';
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir);
  }

  takeScreenshot();

  function takeScreenshot() {
    setTimeout(() => {
      runCounter++;
      try {
        const path = `${dir}/screenshot-${debugScreenshotCounter++}.jpg`;

        logger.debug('[debug] Taking debug screenshot to: ', path);

        page.screenshot({
          path,
          type: 'jpeg',
          quality: 100,
          captureBeyondViewport: true,
        });
      } catch (e) {
        logger.error(`[debug] Screenshot failed`, { cause: e });
      } finally {
        if (runCounter < count) {
          takeScreenshot();
        }
      }
    }, interval);
  }
}

function maskWord(word) {
  if (word.length <= 7) return word;
  return word.slice(0, 7) + '*'.repeat(word.length - 6);
}

module.exports = {
  waitForNetworkIdle,
  takeDebugScreenshot,
  debugConsole,
  maskWord
};
