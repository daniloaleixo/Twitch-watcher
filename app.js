require('dotenv').config();
const puppeteer = require('puppeteer-core');
const dayjs = require('dayjs');
const cheerio = require('cheerio');
var fs = require('fs');
const inquirer = require('./input');
const treekill = require('tree-kill');
const { Console } = require('console');

var run = true;
var firstRun = true;
var cookie = null;
var streamer = process.env.streamer || 'bla';
// ========================================== CONFIG SECTION =================================================================
const configPath = './config.json'
const screenshotFolder = './screenshots/';
const baseUrl = 'https://www.twitch.tv/';
const userAgent = (process.env.userAgent || 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/78.0.3904.108 Safari/537.36');
const timeToRefresh = (Number(process.env.timeToRefresh) || 30); //Minutes

const showBrowser = true; // false state equ headless mode;
const proxy = (process.env.proxy || ""); // "ip:port" By https://github.com/Jan710
const proxyAuth = (process.env.proxyAuth || "");

const browserScreenshot = (process.env.browserScreenshot || false);

const browserClean = 1;
const browserCleanUnit = 'hour';

var browserConfig = {
  headless: !showBrowser,
  args: [
    '--disable-dev-shm-usage',
    '--disable-accelerated-2d-canvas',
    '--no-first-run',
    '--no-zygote',
    '--disable-gpu',
    '--no-sandbox',
    '--disable-setuid-sandbox'
  ]
}; //https://github.com/D3vl0per/Valorant-watcher/issues/24

const cookiePolicyQuery = 'button[data-a-target="consent-banner-accept"]';
const matureContentQuery = 'button[data-a-target="player-overlay-mature-accept"]';
const sidebarQuery = '*[data-test-selector="user-menu__toggle"]';
const userStatusQuery = 'span[data-a-target="presence-text"]';
const channelsQuery = 'a[data-test-selector*="ChannelLink"]';
const streamPauseQuery = 'button[data-a-target="player-play-pause-button"]';
const streamSettingsQuery = '[data-a-target="player-settings-button"]';
const streamQualitySettingQuery = '[data-a-target="player-settings-menu-item-quality"]';
const streamQualityQuery = 'input[data-a-target="tw-radio"]';
// ========================================== CONFIG SECTION =================================================================



async function viewPage(browser, page) {
  var browser_last_refresh = dayjs().add(browserClean, browserCleanUnit);
  var initClock = new Date()
  while (run) {
    try {
      if (dayjs(browser_last_refresh).isBefore(dayjs())) {
        var newSpawn = await cleanup(browser, page);
        browser = newSpawn.browser;
        page = newSpawn.page;
        firstRun = true;
        browser_last_refresh = dayjs().add(browserClean, browserCleanUnit);
      }

      var sleep = timeToRefresh * 60000; //Set watuching timer

      console.log('\n🔗 Now watching streamer: ', baseUrl + streamer);

      await page.goto(baseUrl + streamer, {
        "waitUntil": "networkidle0"
      }); //https://github.com/puppeteer/puppeteer/blob/master/docs/api.md#pagegobackoptions

      await clickWhenExist(page, cookiePolicyQuery);
      await clickWhenExist(page, matureContentQuery); //Click on accept button


      let bodyHTML = await page.evaluate(() => document.body.innerHTML);
      const isOffline = !!bodyHTML.match(/is offline/g)

      if (isOffline) {
        console.log('💡 Stream is offline');
        console.log('🕒 Time: ' + dayjs().format('HH:mm:ss'));
        console.log('💤 Sleeping for ' + sleep / 60000 + ' minutes\n');
      }
      else {
        // Setting mute and low res
        if (firstRun) {
          console.log('🔧 Setting lowest possible resolution..');
          await clickWhenExist(page, streamPauseQuery);

          await clickWhenExist(page, streamSettingsQuery);
          await page.waitFor(streamQualitySettingQuery);

          await clickWhenExist(page, streamQualitySettingQuery);
          await page.waitFor(streamQualityQuery);

          var resolution = await queryOnWebsite(page, streamQualityQuery);
          resolution = resolution[resolution.length - 1].attribs.id;
          await page.evaluate((resolution) => {
            document.getElementById(resolution).click();
          }, resolution);

          await clickWhenExist(page, streamPauseQuery);

          await page.keyboard.press('m'); //For unmute
          firstRun = false;
        }



        // Browser screen shot
        if (browserScreenshot) {
          await page.waitFor(1000);
          fs.access(screenshotFolder, error => {
            if (error) {
              fs.promises.mkdir(screenshotFolder);
            }
          });
          await page.screenshot({
            path: `${screenshotFolder}${streamer}.png`
          });
          console.log('📸 Screenshot created: ' + `${streamer}.png`);
        }

        await clickWhenExist(page, sidebarQuery); //Open sidebar
        await page.waitFor(userStatusQuery); //Waiting for sidebar
        let status = await queryOnWebsite(page, userStatusQuery); //status jQuery
        await clickWhenExist(page, sidebarQuery); //Close sidebar

        const timeDiff = new Date() - initClock;
        console.log('💡 Account status:', status[0] ? status[0].children[0].data : "Unknown");
        console.log('🕒 Time: ' + dayjs().format('HH:mm:ss'), '- having been watching for ', Math.round(timeDiff / 1000 / 60), ' minutes');
        console.log('💤 Watching stream for ' + sleep / 60000 + ' minutes\n');
      }

      await page.waitFor(sleep);
    } catch (e) {
      console.log('🤬 Error: ', e);
      console.log('Please visit the discord channel to receive help: https://discord.gg/s8AH4aZ');
    }
  }
}



async function readLoginData() {
  const cookie = [{
    "domain": ".twitch.tv",
    "hostOnly": false,
    "httpOnly": false,
    "name": "auth-token",
    "path": "/",
    "sameSite": "no_restriction",
    "secure": true,
    "session": false,
    "storeId": "0",
    "id": 1
  }];
  try {
    console.log('🔎 Checking config file...');

    if (fs.existsSync(configPath)) {
      console.log('✅ Json config found!');

      let configFile = JSON.parse(fs.readFileSync(configPath, 'utf8'))

      if (proxy) browserConfig.args.push('--proxy-server=' + proxy);
      browserConfig.executablePath = configFile.exec;
      cookie[0].value = configFile.token;

      return cookie;
    } else if (process.env.token) {
      console.log('✅ Env config found');

      if (proxy) browserConfig.args.push('--proxy-server=' + proxy);
      cookie[0].value = process.env.token; //Set cookie from env
      browserConfig.executablePath = '/usr/bin/chromium-browser'; //For docker container

      return cookie;
    } else {
      console.log('❌ No config file found!');

      let input = await inquirer.askLogin();

      fs.writeFile(configPath, JSON.stringify(input), function (err) {
        if (err) {
          console.log(err);
        }
      });

      if (proxy) browserConfig.args[6] = '--proxy-server=' + proxy;
      browserConfig.executablePath = input.exec;
      cookie[0].value = input.token;

      return cookie;
    }
  } catch (err) {
    console.log('🤬 Error: ', e);
    console.log('Please visit my discord channel to solve this problem: https://discord.gg/s8AH4aZ');
  }
}



async function spawnBrowser() {
  console.log("=========================");
  console.log('📱 Launching browser...');
  var browser = await puppeteer.launch(browserConfig);
  var page = await browser.newPage();

  console.log('🔧 Setting User-Agent...');
  await page.setUserAgent(userAgent); //Set userAgent

  console.log('🔧 Setting auth token...');
  await page.setCookie(...cookie); //Set cookie

  console.log('⏰ Setting timeouts...');
  await page.setDefaultNavigationTimeout(process.env.timeout || 0);
  await page.setDefaultTimeout(process.env.timeout || 0);

  if (proxyAuth) {
    await page.setExtraHTTPHeaders({
      'Proxy-Authorization': 'Basic ' + Buffer.from(proxyAuth).toString('base64')
    })
  }

  return {
    browser,
    page
  };
}



async function checkLogin(page) {
  let cookieSetByServer = await page.cookies();
  for (var i = 0; i < cookieSetByServer.length; i++) {
    if (cookieSetByServer[i].name == 'twilight-user') {
      console.log('✅ Login successful!');
      return true;
    }
  }
  console.log('🛑 Login failed!');
  console.log('🔑 Invalid token!');
  console.log('\nPleas ensure that you have a valid twitch auth-token.\nhttps://github.com/D3vl0per/Valorant-watcher#how-token-does-it-look-like');
  if (!process.env.token) {
    fs.unlinkSync(configPath);
  }
  process.exit();
}




async function clickWhenExist(page, query) {
  let result = await queryOnWebsite(page, query);

  try {
    if (result[0].type == 'tag' && result[0].name == 'button') {
      await page.click(query);
      await page.waitFor(500);
      return;
    }
  } catch (e) { }
}



async function queryOnWebsite(page, query) {
  let bodyHTML = await page.evaluate(() => document.body.innerHTML);
  let $ = cheerio.load(bodyHTML);
  const jquery = $(query);
  return jquery;
}



async function cleanup(browser, page) {
  const pages = await browser.pages();
  await pages.map((page) => page.close());
  await treekill(browser.process().pid, 'SIGKILL');
  //await browser.close();
  return await spawnBrowser();
}




async function shutDown() {
  console.log("\n👋Bye Bye👋");
  run = false;
  process.exit();
}



async function main() {
  console.clear();
  console.log("=========================");
  cookie = await readLoginData();
  var {
    browser,
    page
  } = await spawnBrowser();


  console.log('>> Browser ready')

  console.log('Navigating to home page...')
  await page.goto(baseUrl, {
    "waitUntil": "networkidle0"
  });
  console.log('🔐 Checking login...');
  await checkLogin(page);
  // await scroll(page, scrollTimes);

  console.log("=========================");
  console.log('🔭 Running watcher...');
  await viewPage(browser, page);
};

main();

process.on("SIGINT", shutDown);
process.on("SIGTERM", shutDown);
