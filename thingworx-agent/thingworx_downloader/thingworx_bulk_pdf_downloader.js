/**
 * ThingWorx 9.6 Bulk PDF Downloader
 * ------------------------------------
 * This script uses Puppeteer to:
 *  1. Open the ThingWorx 9.6 Help Center
 *  2. Expand all left-nav menu items
 *  3. Collect every unique page link
 *  4. Visit each page and save it as a PDF
 *
 * SETUP:
 *   npm install puppeteer
 *
 * RUN:
 *   node thingworx_bulk_pdf_downloader.js
 *
 * OUTPUT:
 *   All PDFs saved to ./thingworx_pdfs/ folder
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://support.ptc.com/help/thingworx/platform/r9.6/en/index.html';
const OUTPUT_DIR = './thingworx_pdfs';
const DELAY_MS = 1500; // delay between pages to avoid rate limiting

// ── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function sanitizeFilename(name) {
  return name
    .replace(/[\/\\:*?"<>|]/g, '_')
    .replace(/\s+/g, '_')
    .substring(0, 120)
    .trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  ensureDir(OUTPUT_DIR);

  console.log('🚀 Launching browser...');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });

  // ── Step 1: Load the welcome page ──────────────────────────────────────────
  console.log('📄 Loading ThingWorx Help Center...');
  await page.goto(`${BASE_URL}#page/ThingWorx/Welcome.html`, {
    waitUntil: 'networkidle2',
    timeout: 60000,
  });
  await sleep(2000);

  // ── Step 2: Expand ALL left-nav items ──────────────────────────────────────
  console.log('📂 Expanding all menu items...');

  // Keep clicking collapsed arrows until none remain
  let expanded = true;
  let rounds = 0;
  while (expanded && rounds < 20) {
    expanded = await page.evaluate(() => {
      // PTC help uses <li> with class containing 'collapsed' or arrows with aria-expanded=false
      const arrows = document.querySelectorAll(
        '.ww_skin_page_nav_tree .ww_behavior_expand[aria-expanded="false"], ' +
        '.ww_skin_page_nav .collapsed > .ww_skin_page_nav_item_expander, ' +
        'li.ww_skin_page_nav_item_collapsed > span.ww_skin_page_nav_item_expander, ' +
        '[class*="nav"] [aria-expanded="false"]'
      );
      if (arrows.length === 0) return false;
      arrows.forEach(a => a.click());
      return true;
    });
    await sleep(1000);
    rounds++;
  }

  // ── Step 3: Collect all page links from the nav ────────────────────────────
  console.log('🔗 Collecting page links from navigation...');
  const navLinks = await page.evaluate((baseUrl) => {
    const links = [];
    const seen = new Set();

    // Grab all anchor tags in the left nav tree
    const anchors = document.querySelectorAll(
      '.ww_skin_page_nav a[href], ' +
      '#ww_content_nav a[href], ' +
      '.sidenav a[href], ' +
      'nav a[href]'
    );

    anchors.forEach(a => {
      const href = a.getAttribute('href');
      const text = a.innerText.trim();
      if (!href || !text) return;

      // Build full URL
      let fullUrl;
      if (href.startsWith('http')) {
        fullUrl = href;
      } else if (href.startsWith('#')) {
        fullUrl = baseUrl + href;
      } else {
        fullUrl = baseUrl + '#' + href;
      }

      // Deduplicate
      const key = fullUrl.split('#')[1] || fullUrl;
      if (!seen.has(key)) {
        seen.add(key);
        links.push({ url: fullUrl, title: text });
      }
    });

    return links;
  }, BASE_URL);

  // Fallback: if nav scraping found nothing, use the known top-level sections
  const fallbackPages = [
    { title: '00_Welcome', url: `${BASE_URL}#page/ThingWorx/Welcome.html` },
    { title: '01_Release_Notes', url: `${BASE_URL}#page/ThingWorx/Help/Release_Information/ReleaseNotes.html` },
    { title: '02_System_Requirements', url: `${BASE_URL}#page/ThingWorx/Help/Installation/SystemRequirements.html` },
    { title: '03_Installation_and_Upgrade', url: `${BASE_URL}#page/ThingWorx/Help/Installation/InstallationGuide.html` },
    { title: '04_Getting_Started', url: `${BASE_URL}#page/ThingWorx/Help/GettingStarted/GettingStarted.html` },
    { title: '05_Model_Definition_in_Composer', url: `${BASE_URL}#page/ThingWorx/Help/Composer/Composer.html` },
    { title: '06_Model_and_Data_Best_Practices', url: `${BASE_URL}#page/ThingWorx/Help/BestPractices/ModelingBestPractices.html` },
    { title: '07_Best_Practices_Developing_Solutions', url: `${BASE_URL}#page/ThingWorx/Help/BestPractices/DevelopmentBestPractices.html` },
    { title: '08_Mashup_Builder', url: `${BASE_URL}#page/ThingWorx/Help/Mashup_Builder/MashupBuilder.html` },
    { title: '09_Extensibility', url: `${BASE_URL}#page/ThingWorx/Help/Extensibility/Extensibility.html` },
    { title: '10_REST_API', url: `${BASE_URL}#page/ThingWorx/Help/REST_API/REST_API.html` },
    { title: '11_High_Availability', url: `${BASE_URL}#page/ThingWorx/Help/HighAvailability/HighAvailability.html` },
    { title: '12_Connecting_Systems_and_Devices', url: `${BASE_URL}#page/ThingWorx/Help/ThingWorx_Devices/Devices.html` },
    { title: '13_File_Transfers', url: `${BASE_URL}#page/ThingWorx/Help/FileTransfer/FileTransfer.html` },
  ];

  const pages = navLinks.length > 5 ? navLinks : fallbackPages;
  console.log(`✅ Found ${pages.length} pages to download.\n`);

  // ── Step 4: Visit each page and save as PDF ────────────────────────────────
  let successCount = 0;
  let failCount = 0;

  for (let i = 0; i < pages.length; i++) {
    const { url, title } = pages[i];
    const filename = `${String(i + 1).padStart(4, '0')}_${sanitizeFilename(title)}.pdf`;
    const filepath = path.join(OUTPUT_DIR, filename);

    process.stdout.write(`[${i + 1}/${pages.length}] ${title.substring(0, 60)}... `);

    try {
      await page.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });
      await sleep(DELAY_MS);

      // Wait for main content to render
      await page.waitForSelector('body', { timeout: 10000 }).catch(() => {});

      await page.pdf({
        path: filepath,
        format: 'A4',
        printBackground: true,
        margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' },
        displayHeaderFooter: true,
        headerTemplate: `<div style="font-size:9px; width:100%; text-align:center; color:#666;">${title}</div>`,
        footerTemplate: `<div style="font-size:9px; width:100%; text-align:center; color:#666;">Page <span class="pageNumber"></span> of <span class="totalPages"></span></div>`,
      });

      console.log('✅');
      successCount++;
    } catch (err) {
      console.log(`❌ FAILED: ${err.message.substring(0, 80)}`);
      failCount++;
    }
  }

  await browser.close();

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(`✅ Success: ${successCount} PDFs saved to ./${OUTPUT_DIR}/`);
  console.log(`❌ Failed:  ${failCount} pages`);
  console.log('═══════════════════════════════════════');
})();