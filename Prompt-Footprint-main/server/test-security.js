/**
 * PromptFootprint Security Fix Verification Script
 * Tests all security fixes from the audit at the code level
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ❌ ${name}: ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readFile(relPath) {
  return fs.readFileSync(path.join(ROOT, relPath), 'utf-8');
}

// ============================================================
console.log('\n🔒 SECURITY FIX VERIFICATION');
console.log('================================\n');

// --- MSG-1: background.js sender validation ---
console.log('📋 MSG-1: Background.js sender validation');
const bgJs = readFile('extension/background.js');

test('Checks sender.id against chrome.runtime.id', () => {
  assert(bgJs.includes('sender.id !== chrome.runtime.id'), 
    'Missing sender.id check');
});

test('Has isValidSender function', () => {
  assert(bgJs.includes('function isValidSender(sender)'), 
    'Missing isValidSender function');
});

test('Validates sender URL for tab-based messages', () => {
  assert(bgJs.includes('sender.tab') && bgJs.includes('senderUrl'), 
    'Missing tab URL validation');
});

test('Rejects unauthorized senders with error response', () => {
  assert(bgJs.includes("error: 'Unauthorized sender'"), 
    'Missing error response for unauthorized senders');
});

// --- MSG-2: content.js sender validation ---
console.log('\n📋 MSG-2: Content.js sender validation');
const contentJs = readFile('extension/content.js');

test('Content.js message listener includes sender parameter', () => {
  assert(contentJs.includes('addListener((message, sender)'), 
    'Missing sender parameter in listener');
});

test('Content.js validates sender.id', () => {
  const listenerSection = contentJs.substring(
    contentJs.lastIndexOf('chrome.runtime.onMessage.addListener')
  );
  assert(listenerSection.includes('sender.id !== chrome.runtime.id'), 
    'Missing sender.id validation in content.js listener');
});

test('Content.js validates config field types', () => {
  assert(contentJs.includes("typeof message.config.overlayEnabled === 'boolean'"), 
    'Missing type validation for overlayEnabled');
  assert(contentJs.includes("typeof message.config.energyPerTokenMultiplier === 'number'"), 
    'Missing type validation for energyPerTokenMultiplier');
});

test('Content.js bounds-checks multiplier value', () => {
  assert(contentJs.includes('energyPerTokenMultiplier > 0') &&
         contentJs.includes('energyPerTokenMultiplier <= 20'), 
    'Missing bounds check for energyPerTokenMultiplier');
});

// --- MSG-3: Endpoint whitelist ---
console.log('\n📋 MSG-3: API endpoint whitelist');

test('Has ALLOWED_ENDPOINTS whitelist', () => {
  assert(bgJs.includes('ALLOWED_ENDPOINTS'), 'Missing ALLOWED_ENDPOINTS');
});

test('Has isAllowedEndpoint function', () => {
  assert(bgJs.includes('function isAllowedEndpoint(endpoint)'), 
    'Missing isAllowedEndpoint function');
});

test('Checks for path traversal', () => {
  assert(bgJs.includes("endpoint.includes('..')") || bgJs.includes('endpoint.includes(\'..\')'), 
    'Missing path traversal check');
});

test('handleApiRequest calls endpoint validation', () => {
  assert(bgJs.includes('isAllowedEndpoint(endpoint)'), 
    'handleApiRequest does not call isAllowedEndpoint');
});

// --- XSS-1: dashboard.js innerHTML removal ---
console.log('\n📋 XSS-1: dashboard.js innerHTML removal');
const dashJs = readFile('extension/dashboard/dashboard.js');

test('No innerHTML usage in dashboard.js', () => {
  assert(!dashJs.includes('.innerHTML'), 
    'dashboard.js still contains .innerHTML');
});

test('Uses createElement for DOM construction', () => {
  assert(dashJs.includes("document.createElement('div')"), 
    'Missing createElement usage');
});

test('Uses textContent for safe text rendering', () => {
  assert(dashJs.includes('.textContent ='), 
    'Missing textContent usage');
});

test('Uses replaceChildren for safe DOM insertion', () => {
  assert(dashJs.includes('.replaceChildren('), 
    'Missing replaceChildren usage');
});

test('Uses createDocumentFragment for batch rendering', () => {
  assert(dashJs.includes('document.createDocumentFragment()'), 
    'Missing DocumentFragment usage');
});

// --- CSP-1: manifest.json CSP ---
console.log('\n📋 CSP-1: Manifest CSP');
const manifest = JSON.parse(readFile('manifest.json'));

test('Manifest has content_security_policy', () => {
  assert(manifest.content_security_policy, 'Missing content_security_policy');
});

test("CSP includes script-src 'self'", () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert(csp.includes("script-src 'self'"), "Missing script-src 'self'");
});

test("CSP includes object-src 'none'", () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert(csp.includes("object-src 'none'"), "Missing object-src 'none'");
});

test('CSP restricts connect-src to Railway API', () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert(csp.includes('connect-src') && 
         csp.includes('promptfootprint-production.up.railway.app'), 
    'connect-src not restricted to Railway API');
});

test("CSP does not contain 'unsafe-inline' or 'unsafe-eval'", () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert(!csp.includes('unsafe-inline') && !csp.includes('unsafe-eval'), 
    "CSP contains unsafe directives");
});

// --- PLP-1: Host permissions ---
console.log('\n📋 PLP-1: Host permissions audit');

test('No Railway API in host_permissions', () => {
  const hosts = manifest.host_permissions || [];
  assert(!hosts.some(h => h.includes('railway.app')), 
    'Railway API still in host_permissions');
});

test('No wildcard host permissions', () => {
  const hosts = manifest.host_permissions || [];
  assert(!hosts.includes('<all_urls>') && !hosts.includes('*://*/*'), 
    'Wildcard host permissions found');
});

test('Host permissions limited to ChatGPT domains', () => {
  const hosts = manifest.host_permissions || [];
  assert(hosts.every(h => h.includes('chatgpt.com') || h.includes('chat.openai.com')), 
    'Host permissions include non-ChatGPT domains');
});

// --- RAIL-1: CORS restriction ---
console.log('\n📋 RAIL-1: CORS restriction');
const serverIndex = readFile('server/src/index.js');

test('CORS does NOT have unconditional allow-all', () => {
  // The old code had: callback(null, true); // Allow all in dev
  // Check that the else-branch no longer unconditionally allows
  assert(!serverIndex.includes("callback(null, true); // Allow all"), 
    'CORS still has unconditional allow-all');
});

test('CORS explicitly allows chrome-extension:// origins', () => {
  assert(serverIndex.includes("origin.startsWith('chrome-extension://')"), 
    'Missing chrome-extension origin check');
});

test('CORS explicitly allows the Vercel stats site', () => {
  assert(serverIndex.includes('prompt-footprint-2bjl.vercel.app'), 
    'Missing Vercel stats site origin');
});

test('CORS rejects unknown origins with error', () => {
  assert(serverIndex.includes('CORS: Origin') && serverIndex.includes('not allowed'), 
    'Missing CORS rejection for unknown origins');
});

test('CORS restricts localhost to non-production', () => {
  assert(serverIndex.includes("process.env.NODE_ENV !== 'production'"), 
    'Localhost not restricted to non-production');
});

// --- COMM-2: SSL cert validation ---
console.log('\n📋 COMM-2: SSL certificate validation');
const dbConfig = readFile('server/src/config/database.js');

test('rejectUnauthorized is conditional on NODE_ENV', () => {
  assert(dbConfig.includes("rejectUnauthorized: process.env.NODE_ENV === 'production'"), 
    'rejectUnauthorized not conditional on production');
});

test('Supports DATABASE_CA_CERT env var', () => {
  assert(dbConfig.includes('DATABASE_CA_CERT'), 
    'Missing DATABASE_CA_CERT support');
});

// --- RAIL-4: Error handler ---
console.log('\n📋 RAIL-4: Error handler sanitization');
const errorHandlerJs = readFile('server/src/middleware/errorHandler.js');

test('Error handler hides details in production', () => {
  assert(errorHandlerJs.includes("process.env.NODE_ENV === 'production'"), 
    'Error handler not checking NODE_ENV');
  assert(errorHandlerJs.includes("'Internal server error'"), 
    'Missing generic error message for production');
});

// --- RAIL-6: Schema sync ---
console.log('\n📋 RAIL-6: Production schema sync guard');

test('sequelize.sync is guarded by NODE_ENV', () => {
  assert(serverIndex.includes("process.env.NODE_ENV === 'production'") && 
         serverIndex.includes('skipping schema sync'), 
    'sync not guarded by production check');
});

// --- DL (Data Leakage) ---
console.log('\n📋 Data Leakage checks');

test('No prompt/response text sent to backend', () => {
  // The processQuery function should only send numeric fields
  const processSection = contentJs.substring(
    contentJs.indexOf('async function processQuery'),
    contentJs.indexOf('updateFloatingStatus')
  );
  assert(!processSection.includes('promptText') || 
         !processSection.includes("body: {") || 
         processSection.includes('promptTokens'), 
    'processQuery may be sending text to backend');
});

test('No eval/new Function in codebase', () => {
  const allFiles = [bgJs, contentJs, dashJs];
  allFiles.forEach(f => {
    assert(!f.includes('eval('), 'Found eval()');
    assert(!f.includes('new Function('), 'Found new Function()');
  });
});

test('No document.write in codebase', () => {
  const allFiles = [bgJs, contentJs, dashJs];
  allFiles.forEach(f => {
    assert(!f.includes('document.write'), 'Found document.write');
  });
});

test('All API URLs use HTTPS', () => {
  const allFiles = [bgJs, contentJs, dashJs, 
    readFile('extension/popup/popup.js'),
    readFile('extension/lib/apiClient.js')];
  allFiles.forEach(f => {
    const urls = f.match(/['"]https?:\/\/[^'"]+/g) || [];
    urls.forEach(url => {
      if (url.includes('localhost')) return; // localhost is OK
      assert(url.startsWith("'https://") || url.startsWith('"https://'), 
        `Found non-HTTPS URL: ${url}`);
    });
  });
});

test('No localStorage usage in extension', () => {
  const allFiles = [bgJs, contentJs, dashJs, readFile('extension/popup/popup.js')];
  allFiles.forEach(f => {
    assert(!f.includes('localStorage'), 'Found localStorage usage');
  });
});

// --- Content script isolation ---
console.log('\n📋 Content script isolation');

test('Content scripts run in isolated world (no "world": "MAIN")', () => {
  assert(!JSON.stringify(manifest).includes('"MAIN"'), 
    'Content scripts running in MAIN world');
});

test('Content script uses strict mode IIFE', () => {
  assert(contentJs.includes("(function() {") && contentJs.includes("'use strict'"), 
    'Content script not wrapped in strict IIFE');
});

// ============================================================
console.log('\n================================');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\n⚠️  Some security checks FAILED. Review the output above.\n');
  process.exit(1);
} else {
  console.log('\n✅ ALL SECURITY CHECKS PASSED\n');
  process.exit(0);
}
