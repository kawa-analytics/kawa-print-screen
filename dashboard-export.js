const { getActiveLogger } = require('./log');
const logger = getActiveLogger();

const { waitForNetworkIdle, debugConsole } = require('./utils');

const config = require('./config.json');
const puppeteer = require('puppeteer-core');
const crypto = require('node:crypto');
const PDFDocument = require('pdfkit');
const fs = require('node:fs');


// do not use x,y less than 13 millimeters (safety print)
// same value is used when generating preview in dashboard
const paddingSize = 15;

function calculatePageParameters(processVars) {
  const height = parseInt(processVars.KAWA_FORMAT_HEIGHT, 10);
  const width = parseInt(processVars.KAWA_FORMAT_WIDTH, 10);
  const orientation = width > height ? 'landscape' : 'portrait';
  const imageWidth = width - paddingSize * 2;
  const imageHeight = height - paddingSize * 2;

  return { height, width, orientation, imageWidth, imageHeight, paddingSize };
}

let pageParameters = {
  width: 297,
  height: 210,
  orientation: 'landscape',
  imageWidth: 297 - paddingSize * 2,
  imageHeight: 210 - paddingSize * 2,
};

const pathToFolder = '/tmp';

const puppeteerLogger = logger.child({ service: 'dashboard_export.puppeteer' });

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
      // '--remote-debugging-port=9222',
    ],
  });

  const viewComputationResults = (count, results) => {
    return new Promise((resolve, reject) => {
      let success, failure;

      success = setInterval(() => {
        if (results.requests === count && results.responses === count) {
          clearInterval(success);
          clearTimeout(failure);
          resolve();
        }
      }, 1000);

      const timeout = 60000;
      failure = setTimeout(() => {
        clearInterval(success);
        reject();
      }, timeout);
    });
  };

  try {
    const {
      KAWA_PRINCIPAL_ID,
      KAWA_SERVER_URL,
      KAWA_WORKSPACE_ID,
      KAWA_DASHBOARD_ID,
      KAWA_FORMAT_WIDTH,
      KAWA_FORMAT_HEIGHT,
    } = process.env;

    info(
      `Have these environment variables: ${JSON.stringify({
        KAWA_PRINCIPAL_ID,
        KAWA_SERVER_URL,
        KAWA_WORKSPACE_ID,
        KAWA_DASHBOARD_ID,
        KAWA_FORMAT_WIDTH,
        KAWA_FORMAT_HEIGHT,
      })}`,
    );

    pageParameters = calculatePageParameters(process.env);

    info(`Calculated page parameters: ${JSON.stringify(pageParameters)}`);

    // 16:10 is the optimal ratio of the viewport to capture the bottom of widgets
    // and 1600 is the optimal width with scale factor 2.5,
    // increasing the width beyond 1600 will produce very tiny text
    // for the portrait format, we use inverted numbers
    const VIEWPORT_LARGER_SIDE = 1600;
    const VIEWPORT_SMALLER_SIDE = 1000;
    const DEVICE_SCALE_FACTOR = 2.5;

    const [viewPortWidth, viewPortHeight] =
      pageParameters.orientation === 'landscape'
        ? [VIEWPORT_LARGER_SIDE, VIEWPORT_SMALLER_SIDE]
        : [VIEWPORT_SMALLER_SIDE, VIEWPORT_LARGER_SIDE];

    const serverUrl = config.serverUrl || KAWA_SERVER_URL;
    const exportMode = `?mode=export&width=${KAWA_FORMAT_WIDTH}&height=${KAWA_FORMAT_HEIGHT}&fullPage=true`;
    const url = `${serverUrl}/workspaces/${KAWA_WORKSPACE_ID}/dashboards/${KAWA_DASHBOARD_ID}${exportMode}`;


    info('Create new page');
    const page = await browser.newPage();

    // debugConsole(page);

    const viewPortSize = {
      width: viewPortWidth,
      height: viewPortHeight,
      deviceScaleFactor: DEVICE_SCALE_FACTOR,
    };

    info(`Setting viewport size: ${JSON.stringify(viewPortSize)}`);

    await page.setViewport(viewPortSize);

    const cookies = [
      {
        name: 'X-KAWA-PRINCIPAL-ID',
        value: KAWA_PRINCIPAL_ID,
        domain: domain,
      },
      {
        name: 'X-KAWA-API-KEY',
        value: KAWA_API_KEY,
        domain: domain,
      },
    ];
    await page.setCookie(...cookies);

    await page.setRequestInterception(true);

    const results = { requests: 0, responses: 0 };

    page.on('request', (request) => {
      if (request.url().includes('computation/compute-batch')) {
        results.requests++;
      }
      request.continue();
    });

    page.on('response', (response) => {
      if (response.url().includes('computation/compute-batch')) {
        results.responses++;
      }
    });

    info(`Navigate to url ${url}`);

    /*
    await Promise.all([
      page.goto(url, { timeout: 60 * 1000, waitUntil: ['domcontentloaded'] }),
      waitForNetworkIdle(page, { maxInflightRequests: 0 }),
    ]);
  */

    await page.goto(url, {
      timeout: 60 * 1000,
      waitUntil: ['domcontentloaded', 'networkidle2'],
    });

    const hostElementSelector = '.dashboard-print-preview-container';
    const gridStackPageSelector = '.preview-grid-stack';
    const widgetContainerSelector = 'kw-widget-container';
    const sheetWidgetSelector = 'kw-sheet-widget';

    info(
      `Waiting for hostElementSelector=${hostElementSelector} and gridStackPageSelector=${gridStackPageSelector} elements`,
    );

    await page.waitForSelector(hostElementSelector);
    await page.waitForSelector(gridStackPageSelector);

    info(
      `Reading dashboard information from the host element: expectedTotalWidgetsCount, expectedSheetWidgetsCount, expectedPagesCount`,
    );

    const [expectedTotalWidgetsCount, expectedSheetWidgetsCount, expectedPagesCount] =
      await page.$eval(hostElementSelector, (node) => {
        return [
          Number(node.getAttribute('total-widgets-count')),
          Number(node.getAttribute('sheet-widgets-count')),
          Number(node.getAttribute('print-layout-page-count')),
        ];
      });

    info(`
        Information successfully obtained, waiting for widgets, containers and preview pages to load: 
            expectedTotalWidgetsCount: ${expectedTotalWidgetsCount}, 
            expectedSheetWidgetsCount: ${expectedSheetWidgetsCount}, 
            expectedPagesCount: ${expectedPagesCount}`);

    let widgetContainers = await page.$$(widgetContainerSelector);

    while (widgetContainers.length < expectedTotalWidgetsCount) {
      widgetContainers = await page.$$(gridStackPageSelector);
    }

    let sheetWidgets = await page.$$(sheetWidgetSelector);

    while (sheetWidgets.length < expectedSheetWidgetsCount) {
      sheetWidgets = await page.$$(sheetWidgetSelector);
    }

    let gridStackPages = await page.$$(gridStackPageSelector);

    while (gridStackPages.length < expectedPagesCount) {
      gridStackPages = await page.$$(gridStackPageSelector);
    }

    if (expectedSheetWidgetsCount > 0) {
      info(`Waiting for compute results for sheet widgets`);
      await viewComputationResults(expectedSheetWidgetsCount, results);
    }

    // allow 2s for no network activity
    // await waitForNetworkIdle(page, { waitForLastRequest: 2000 });
    await page.waitForNetworkIdle(2000);

    // allow 2s for views to render
    await page.waitForTimeout(2000);

    const screenshots = [];

    info(`Starting to take screenshots for ${gridStackPages.length} pages`);

    for await (let page of gridStackPages) {
      const filePath = `${pathToFolder}/${crypto.randomUUID()}.jpg`;
      screenshots.push(filePath);
      await page.screenshot({
        path: filePath,
        type: 'jpeg',
        quality: 100,
      });
    }

    info(`Screenshots taken, emitting array of files ${JSON.stringify(screenshots)}`);

    return JSON.stringify(screenshots);
  } catch (cause) {
    throw new Error(`Error happened while capturing screenshots`, { cause });
  } finally {
    info(`Closing browser`);
    await browser.close();
  }
};

const PostScriptPointToPx = (p) => (p * 96) / 72;
const PostScriptPxToPoint = (p) => (p * 72) / 96;
const PostScriptPointToMm = (p) => (p * 25.4) / 72;
const PostScriptMmToPoint = (p) => (p * 72) / 25.4;

const pdfKitLogger = logger.child({ service: 'dashboard_export.pdfKit' });

function generatePdf(r) {
  return new Promise((resolve, reject) => {
    pdfKitLogger.info(`Starting to generate PDF document`);

    const images = JSON.parse(r);

    const doc = new PDFDocument({ autoFirstPage: false });

    const filePath = `${pathToFolder}/${crypto.randomUUID()}.pdf`;
    const file = fs.createWriteStream(filePath);

    doc.pipe(file);

    file.on('finish', () => resolve(filePath));
    file.on('error', (e) => reject(e));

    pdfKitLogger.info(`Adding pages with images to PDF document`);

    for (let p of images) {
      doc
        .addPage({
          margin: PostScriptMmToPoint(pageParameters.paddingSize),
          size: [
            PostScriptMmToPoint(pageParameters.width),
            PostScriptMmToPoint(pageParameters.height),
          ],
        })
        .image(p, {
          fit: [
            PostScriptMmToPoint(pageParameters.imageWidth),
            PostScriptMmToPoint(pageParameters.imageHeight),
          ],
          align: 'center',
          valign: 'center',
        });
    }

    pdfKitLogger.info(`Finished generating PDF document`);

    doc.end();
  });
}

const emitResult = (r) => console.log(r);

takeScreenshots()
  .then(generatePdf)
  .then(emitResult)
  .catch((cause) => {
    error(
      new Error(
        'Error happened in the pipeline of capturing screenshots and generating PDF document',
        { cause },
      ),
    );
  });
