const { getActiveLogger } = require('./log');
const logger = getActiveLogger();

const config = require('./config.json');
const puppeteer = require('puppeteer-core');
const crypto = require('crypto');
const { waitForNetworkIdle } = require('./utils');

const puppeteerLogger = logger.child({ service: 'chart_export.puppeteer' });

// child logger changes type of the info object,
// so we need to pass an instance of the error through `message` property
// see https://github.com/winstonjs/winston/issues/2381
const error = (e) => puppeteerLogger.error({ message: e });
const info = (msg) => puppeteerLogger.info(msg);

const takeScreenshots = async () => {
  info('Start puppeteer script');
  info('Launch browser');

  const browser = await puppeteer.launch({
    headless: 'new',
    executablePath: config.pathToChrome,
    args: [
      '--accept-lang=en-GB',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  try {
    const { KAWA_PRINCIPAL_ID, KAWA_SERVER_URL, KAWA_WORKSPACE_ID, KAWA_SHEET_ID, KAWA_LAYOUT_ID } =
      process.env;

    info(
      `Have these environment variables: ${JSON.stringify({
        KAWA_PRINCIPAL_ID,
        KAWA_SERVER_URL,
        KAWA_WORKSPACE_ID,
        KAWA_SHEET_ID,
        KAWA_LAYOUT_ID,
      })}`,
    );

    const url = `${KAWA_SERVER_URL}/workspaces/${KAWA_WORKSPACE_ID}/sheets/${KAWA_SHEET_ID}/views/${KAWA_LAYOUT_ID}?mode=export`;

    info('Create new page');
    const page = await browser.newPage();

    // 16:10 is the optimal ratio for the viewport
    const VIEWPORT_WIDTH = 1600;
    const VIEWPORT_HEIGHT = 1000;
    const DEVICE_SCALE_FACTOR = 2.5;

    await page.setViewport({
      width: Number(VIEWPORT_WIDTH),
      height: Number(VIEWPORT_HEIGHT),
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    });

    const cookies = [
      {
        name: 'X-KAWA-PRINCIPAL-ID',
        value: KAWA_PRINCIPAL_ID,
        domain: '127.0.0.1',
      },
    ];

    await page.setCookie(...cookies);

    info(`Navigate to url ${url}`);

    await Promise.all([
      page.goto(url, { timeout: 60 * 1000, waitUntil: ['domcontentloaded'] }),
      waitForNetworkIdle(page, { maxInflightRequests: 0 }),
    ]);

    const elementSelector = '.custom-charts-elements-container';

    info(`Waiting for DOM element:  ${elementSelector}`);

    await page.waitForSelector(elementSelector);

    const inputElement = await page.$(elementSelector);

    const filePath = `/tmp/${crypto.randomUUID()}.jpg`;

    info(`Taking a screenshot to be saved to ${filePath}`);

    await inputElement.screenshot({
      path: filePath,
      type: 'jpeg',
      quality: 100,
      captureBeyondViewport: true,
    });

    return filePath;
  } catch (cause) {
    throw new Error(`Error happened while capturing screenshots`, { cause });
  } finally {
    info(`Closing browser`);
    await browser.close();
  }
};

const emitResult = (r) => console.log(r);

takeScreenshots()
  .then(emitResult)
  .catch((cause) => {
    error(new Error('Error happened in the pipeline of capturing screenshots', { cause }));
  });
