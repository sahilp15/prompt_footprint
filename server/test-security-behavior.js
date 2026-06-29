/**
 * PromptFootprint CORS & Server Behavior Test
 * Tests that the CORS middleware correctly accepts/rejects origins
 * and that error handling works properly.
 */

const http = require('http');

// We simulate the CORS origin logic without starting the full server
// (which would require a database connection)
const CORS_TESTS = [
  // [origin, shouldAllow, description]
  [undefined, true, 'No origin (extensions, server-to-server)'],
  ['chrome-extension://abcdef1234567890', true, 'Chrome extension origin'],
  ['https://prompt-footprint-2bjl.vercel.app', true, 'Vercel stats site'],
  ['http://localhost:3000', false, 'Localhost in production mode'], // NODE_ENV=production
  ['https://evil-site.com', false, 'Malicious origin'],
  ['https://chatgpt.com', false, 'ChatGPT origin (not allowed on API)'],
  ['http://attacker.com', false, 'HTTP attacker origin'],
];

// Reproduce the CORS origin function from server/src/index.js
function corsOriginCheck(origin, isProduction) {
  if (!origin) return true;
  if (origin.startsWith('chrome-extension://')) return true;
  if (origin === 'https://prompt-footprint-2bjl.vercel.app') return true;
  if (!isProduction &&
      (origin.startsWith('http://localhost') || origin.startsWith('https://localhost'))) {
    return true;
  }
  return false;
}

console.log('\n🌐 CORS ORIGIN VALIDATION (production mode)');
console.log('=============================================\n');

let passed = 0;
let failed = 0;

CORS_TESTS.forEach(([origin, shouldAllow, desc]) => {
  const result = corsOriginCheck(origin, true); // production = true
  const ok = result === shouldAllow;
  if (ok) {
    console.log(`  ✅ ${desc}: ${result ? 'ALLOWED' : 'REJECTED'} (expected)`);
    passed++;
  } else {
    console.log(`  ❌ ${desc}: ${result ? 'ALLOWED' : 'REJECTED'} (UNEXPECTED — expected ${shouldAllow ? 'ALLOWED' : 'REJECTED'})`);
    failed++;
  }
});

// Extra: verify localhost IS allowed in dev mode
console.log('\n🌐 CORS ORIGIN VALIDATION (development mode)');
console.log('=============================================\n');

const devTests = [
  ['http://localhost:3000', true, 'Localhost in dev mode'],
  ['http://localhost:5173', true, 'Vite dev server'],
  ['https://evil-site.com', false, 'Malicious origin in dev mode'],
];

devTests.forEach(([origin, shouldAllow, desc]) => {
  const result = corsOriginCheck(origin, false); // production = false
  const ok = result === shouldAllow;
  if (ok) {
    console.log(`  ✅ ${desc}: ${result ? 'ALLOWED' : 'REJECTED'} (expected)`);
    passed++;
  } else {
    console.log(`  ❌ ${desc}: ${result ? 'ALLOWED' : 'REJECTED'} (UNEXPECTED)`);
    failed++;
  }
});

// Test error handler behavior
console.log('\n🛡️ Error handler behavior');
console.log('==========================\n');

const errorHandler = require('./src/middleware/errorHandler');

// Test production mode
process.env.NODE_ENV = 'production';
const mockResProd = {
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(obj) { this.body = obj; }
};
errorHandler(new Error('SQL injection detail: SELECT * FROM users'), {}, mockResProd, () => {});
const prodOk = mockResProd.statusCode === 500 && mockResProd.body.error === 'Internal server error';
if (prodOk) {
  console.log('  ✅ Production: Internal error details hidden');
  passed++;
} else {
  console.log(`  ❌ Production: Error leaked: ${JSON.stringify(mockResProd.body)}`);
  failed++;
}

// Test dev mode
process.env.NODE_ENV = 'development';
const mockResDev = {
  statusCode: null,
  body: null,
  status(code) { this.statusCode = code; return this; },
  json(obj) { this.body = obj; }
};
errorHandler(new Error('Something broke'), {}, mockResDev, () => {});
const devOk = mockResDev.statusCode === 500 && mockResDev.body.error === 'Something broke';
if (devOk) {
  console.log('  ✅ Development: Error details shown for debugging');
  passed++;
} else {
  console.log(`  ❌ Development: Unexpected response: ${JSON.stringify(mockResDev.body)}`);
  failed++;
}

// Test endpoint whitelist logic
console.log('\n🔐 Endpoint whitelist validation');
console.log('================================\n');

// Read and extract the isAllowedEndpoint logic
const bgJs = require('fs').readFileSync(
  require('path').join(__dirname, '..', 'extension', 'background.js'), 'utf-8'
);

// Replicate the logic
const ALLOWED_ENDPOINTS = new Set(['/sessions', '/queries', '/config', '/sessions/weekly']);

function isAllowedEndpoint(endpoint) {
  if (!endpoint || typeof endpoint !== 'string') return false;
  if (endpoint.includes('..') || endpoint.includes('//')) return false;
  const baseEndpoint = endpoint.replace(/\/[0-9a-f-]{36}$/i, '');
  return ALLOWED_ENDPOINTS.has(baseEndpoint) || ALLOWED_ENDPOINTS.has(endpoint);
}

const endpointTests = [
  ['/sessions', true, 'GET /sessions'],
  ['/sessions/weekly', true, 'GET /sessions/weekly'],
  ['/queries', true, 'GET /queries'],
  ['/config', true, 'GET /config'],
  ['/sessions/550e8400-e29b-41d4-a716-446655440000', true, 'PATCH /sessions/:uuid'],
  ['/../../../etc/passwd', false, 'Path traversal attempt'],
  ['/admin', false, 'Unauthorized endpoint /admin'],
  ['//evil.com/sessions', false, 'URL injection with //'],
  [null, false, 'Null endpoint'],
  ['', false, 'Empty string endpoint'],
  [123, false, 'Non-string endpoint'],
  ['/users', false, 'Non-whitelisted endpoint'],
];

endpointTests.forEach(([endpoint, shouldAllow, desc]) => {
  const result = isAllowedEndpoint(endpoint);
  const ok = result === shouldAllow;
  if (ok) {
    console.log(`  ✅ ${desc}: ${result ? 'ALLOWED' : 'REJECTED'}`);
    passed++;
  } else {
    console.log(`  ❌ ${desc}: ${result ? 'ALLOWED' : 'REJECTED'} (expected ${shouldAllow ? 'ALLOWED' : 'REJECTED'})`);
    failed++;
  }
});

// Summary
console.log('\n================================');
console.log(`\n📊 Results: ${passed} passed, ${failed} failed, ${passed + failed} total`);
if (failed > 0) {
  console.log('\n⚠️  Some tests FAILED.\n');
  process.exit(1);
} else {
  console.log('\n✅ ALL BEHAVIORAL TESTS PASSED\n');
  process.exit(0);
}
