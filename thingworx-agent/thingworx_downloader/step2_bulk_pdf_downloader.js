/**
 * STEP 2 — PUPPETEER BULK PDF DOWNLOADER
 * ========================================
 * Prerequisites:
 *   1. Run step1_extract_links.js in your browser console first
 *   2. Save the downloaded thingworx_links.json next to this file
 *   3. npm install puppeteer
 *
 * Run:
 *   node step2_bulk_pdf_downloader.js
 *
 * Output:
 *   PDFs saved to ./thingworx_pdfs/<Section>/<page>.pdf
 */

const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// ── Config ────────────────────────────────────────────────────────────────────
const LINKS_FILE = './thingworx_links.json';
const OUTPUT_DIR = './thingworx_pdfs';
const DELAY_MS = 1800;          // ms between pages (be polite to the server)
const PAGE_TIMEOUT = 45000;     // ms to wait for page load
const CONCURRENCY = 1;          // keep at 1 to avoid getting blocked

// ── Helpers ───────────────────────────────────────────────────────────────────
function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

function sanitize(name) {
  return (name || 'untitled')
    .replace(/[\/\\:*?"<>|#]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/__+/g, '_')
    .substring(0, 100)
    .trim();
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Main ──────────────────────────────────────────────────────────────────────
(async () => {

  // Load links
  if (!fs.existsSync(LINKS_FILE)) {
    console.error(`❌ File not found: ${LINKS_FILE}`);
    console.error('   Please run step1_extract_links.js in your browser console first!');
    process.exit(1);
  }

  const allLinks = JSON.parse(fs.readFileSync(LINKS_FILE, 'utf-8'));
  console.log(`📋 Loaded ${allLinks.length} links from ${LINKS_FILE}`);
  ensureDir(OUTPUT_DIR);

  // Group by section (depth=0 items are sections, depth>0 are sub-pages)
  // Build a structured map: section → [pages]
  const sections = {};
  let currentSection = 'General';

  allLinks.forEach(link => {
    if (link.depth === 0 || !link.parentTitle) {
      currentSection = link.title || 'General';
      if (!sections[currentSection]) sections[currentSection] = [];
      sections[currentSection].push(link); // section landing page
    } else {
      const key = link.parentTitle || currentSection;
      if (!sections[key]) sections[key] = [];
      sections[key].push(link);
    }
  });

  // Print summary
  console.log('\n📂 Structure to download:');
  let totalPages = 0;
  Object.entries(sections).forEach(([section, pages]) => {
    console.log(`  📁 ${section}: ${pages.length} pages`);
    totalPages += pages.length;
  });
  console.log(`\n🔢 Total pages: ${totalPages}\n`);

  // Launch browser
  console.log('🚀 Launching Chromium browser...\n');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-web-security',
    ],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });

  // Suppress console noise from the docs site
  page.on('console', () => {});
  page.on('pageerror', () => {});

  let successCount = 0;
  let failCount = 0;
  let pageIndex = 0;

  // ── Iterate sections ───────────────────────────────────────────────────────
  for (const [sectionName, pages] of Object.entries(sections)) {
    const sectionDir = path.join(OUTPUT_DIR, sanitize(sectionName));
    ensureDir(sectionDir);
    console.log(`\n📁 Section: ${sectionName} (${pages.length} pages)`);

    for (let i = 0; i < pages.length; i++) {
      pageIndex++;
      const { title, url } = pages[i];
      const filename = `${String(i + 1).padStart(3, '0')}_${sanitize(title)}.pdf`;
      const filepath = path.join(sectionDir, filename);

      // Skip if already downloaded
      if (fs.existsSync(filepath)) {
        console.log(`  [${pageIndex}/${totalPages}] ⏭️  Skipping (exists): ${title.substring(0, 60)}`);
        successCount++;
        continue;
      }

      process.stdout.write(`  [${pageIndex}/${totalPages}] ${title.substring(0, 60).padEnd(62)}... `);

      try {
        await page.goto(url, {
          waitUntil: 'networkidle2',
          timeout: PAGE_TIMEOUT,
        });

        // Wait for content to render (PTC help uses JS rendering)
        await sleep(DELAY_MS);

        // Try to hide the left nav so PDF is just the content
        await page.evaluate(() => {
          const selectors = [
            '#ww_nav_tree', '.ww_skin_page_nav', '#ww_content_nav',
            '[class*="sidenav"]', '[class*="nav_tree"]', '.ww_skin_banner',
            '.ww_skin_breadcrumb', '.ww_skin_toolbar', '#ww_toolbar',
          ];
          selectors.forEach(sel => {
            document.querySelectorAll(sel).forEach(el => {
              el.style.display = 'none';
            });
          });
          // Expand the main content area
          const content = document.querySelector(
            '#ww_content_div, .ww_skin_page_content, [class*="content_div"], main'
          );
          if (content) {
            content.style.width = '100%';
            content.style.marginLeft = '0';
          }
        }).catch(() => {});

        await page.pdf({
          path: filepath,
          format: 'A4',
          printBackground: true,
          margin: {
            top: '20mm',
            bottom: '20mm',
            left: '15mm',
            right: '15mm',
          },
          displayHeaderFooter: true,
          headerTemplate: `
            <div style="font-size:8px; width:100%; padding:0 15mm;
                        display:flex; justify-content:space-between; color:#555;">
              <span>ThingWorx 9.6 Documentation</span>
              <span>${sectionName.substring(0, 60)}</span>
            </div>`,
          footerTemplate: `
            <div style="font-size:8px; width:100%; padding:0 15mm;
                        display:flex; justify-content:space-between; color:#555;">
              <span>${title.substring(0, 80)}</span>
              <span>Page <span class="pageNumber"></span> / <span class="totalPages"></span></span>
            </div>`,
        });

        console.log('✅');
        successCount++;

      } catch (err) {
        console.log(`❌  ${err.message.substring(0, 60)}`);
        failCount++;

        // Log failures for retry
        fs.appendFileSync(
          path.join(OUTPUT_DIR, 'failed_pages.txt'),
          `${url}\t${title}\n`
        );
      }
    }
  }

  await browser.close();

  // ── Final summary ──────────────────────────────────────────────────────────
  console.log('\n╔═══════════════════════════════════════════╗');
  console.log(`║  ✅ Success: ${String(successCount).padEnd(4)} PDFs saved                ║`);
  console.log(`║  ❌ Failed:  ${String(failCount).padEnd(4)} pages (see failed_pages.txt) ║`);
  console.log(`║  📁 Output:  ${OUTPUT_DIR.padEnd(30)} ║`);
  console.log('╚═══════════════════════════════════════════╝');

  if (failCount > 0) {
    console.log('\n💡 To retry failed pages, re-run the script (it skips already-downloaded PDFs)');
  }

})();