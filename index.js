const express = require('express');
const puppeteer = require('puppeteer-extra');
const freeport = require('freeport');
const ProxyChain = require('proxy-chain');
const { exec } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('path');

const StealthPlugin = require('puppeteer-extra-plugin-stealth');
puppeteer.use(StealthPlugin());

const execPromise = promisify(exec);
const app = express();
const PORT = process.env.PORT || 3000;

app.set('json spaces', 2);
app.use(express.json());
app.use(express.static('public'));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'docs.html'));
});

async function login(email, pass) {
  let proxyServer;
  let browser;
  try {
    const port = await promisify(freeport)();
    proxyServer = new ProxyChain.Server({ port });
    proxyServer.listen();

    const { stdout: chromiumPath } = await execPromise('which chromium');
    browser = await puppeteer.launch({
      headless: false,
      executablePath: chromiumPath.trim(),
      ignoreHTTPSErrors: true,
      args: [
        '--ignore-certificate-errors',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-dev-shm-usage',
        '--no-sandbox',
        `--proxy-server=127.0.0.1:${port}`
      ]
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 375, height: 667 });
    await page.setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 14_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0 Mobile/15E148 Safari/604.1');
    await page.goto('https://mbasic.facebook.com');

    await page.waitForSelector('#m_login_email', { visible: true });
    await page.type('#m_login_email', email);

    await page.waitForSelector('input[name="pass"]', { visible: true });
    await page.type('input[name="pass"]', pass);

    const loginButtonSelector = 'div[aria-label="Log in"]';
    await page.waitForSelector(loginButtonSelector, { visible: true });
    await page.click(loginButtonSelector);

    await page.waitForTimeout(2000);

    const wrongCredentialsSelector = 'div[aria-label="Wrong Credentials"]';
    const wrongCredentialsMessageSelector = 'div[class*="wbloks_49"]';

    try {
      await page.waitForSelector(wrongCredentialsSelector, { timeout: 3000 });
      const wrongCredentialsMessage = await page.$eval(wrongCredentialsMessageSelector, el => el.innerText);
      return { success: false, message: wrongCredentialsMessage };
    } catch {
      // No login error detected, continue checking for save login info prompt
    }

    const saveLoginInfoSelector = 'div.wbloks_118';
    if (await page.$(saveLoginInfoSelector)) {
      await page.click('div[aria-label="Save"]'); // Assuming a button to save appears
    }

    await page.waitForNavigation({ waitUntil: 'networkidle0' });
    await page.goto('https://m.facebook.com');

    const cookies = await page.cookies();
    const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    const jsonCookies = cookies.map(cookie => ({
      name: cookie.name,
      value: cookie.value,
      path: cookie.path,
      hostOnly: cookie.hostOnly || false,
      domain: cookie.domain,
      creation: Date.now(),
      lastAccessed: Date.now(),
    }));

    const datrCookie = cookies.find(cookie => cookie.name === 'datr') || {};
    return {
      success: true,
      cookies: cookieString,
      jsonCookies,
      datr: datrCookie.value || null,
    };

  } catch (error) {
    console.error("Login error:", error);
    return { success: false, error: "Please use another account, as this one needs a code, or try using the C3C or Global Cookies extension to retrieve your cookies." };
  } finally {
    if (proxyServer) proxyServer.close();
    if (browser) await browser.close();
  }
}

app.post('/login', async (req, res) => {
  const { email, pass } = req.body;
  try {
    const response = await login(email, pass);
    if (!response.success && response.error) {
      // Explicitly send the error message if it exists in the response
      res.status(500).json({ error: response.error });
    } else {
      res.json(response);
    }
  } catch (error) {
    console.error("Request error:", error);
    res.status(500).json({ error: "Please use another account, as this one needs a code, or try using the C3C or Global Cookies extension to retrieve your cookies." });
  }
});

app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});
