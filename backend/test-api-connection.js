#!/usr/bin/env node

/**
 * API Connection Testing Script
 * Tests connectivity between frontend and Render backend
 * Run: node test-api-connection.js
 */

const https = require('https');
const http = require('http');

const BACKEND_URL = 'https://skill-boost-nexus.onrender.com';
const ENDPOINTS = [
  '/api/health',
  '/api/courses',
  '/api/notifications'
];

const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m'
};

function log(color, message) {
  console.log(`${color}${message}${colors.reset}`);
}

function testEndpoint(url) {
  return new Promise((resolve) => {
    const protocol = url.startsWith('https') ? https : http;
    const timeStart = Date.now();

    protocol.get(url, { timeout: 10000 }, (res) => {
      const duration = Date.now() - timeStart;
      resolve({
        success: true,
        status: res.statusCode,
        duration,
        message: `${res.statusCode} OK (${duration}ms)`
      });
    }).on('error', (error) => {
      resolve({
        success: false,
        status: null,
        duration: Date.now() - timeStart,
        message: `Error: ${error.message}`
      });
    });
  });
}

async function runTests() {
  log(colors.blue, '\n╔════════════════════════════════════════════════╗');
  log(colors.blue, '║  API Connection Testing - Skill Boost Nexus   ║');
  log(colors.blue, '╚════════════════════════════════════════════════╝\n');

  log(colors.yellow, `Testing Backend: ${BACKEND_URL}\n`);

  let passed = 0;
  let failed = 0;

  for (const endpoint of ENDPOINTS) {
    const fullUrl = BACKEND_URL + endpoint;
    log(colors.blue, `Testing: ${endpoint}`);
    
    const result = await testEndpoint(fullUrl);
    
    if (result.success && result.status < 500) {
      log(colors.green, `  ✓ ${result.message}`);
      passed++;
    } else {
      log(colors.red, `  ✗ ${result.message}`);
      failed++;
    }
  }

  log(colors.blue, '\n╔════════════════════════════════════════════════╗');
  log(colors.green, `║  Results: ${passed} passed, ${failed} failed${' '.repeat(Math.max(0, 19 - String(passed + failed).length))}║`);
  log(colors.blue, '╚════════════════════════════════════════════════╝\n');

  if (failed === 0) {
    log(colors.green, '✓ All tests passed! Backend is accessible.');
  } else {
    log(colors.red, '✗ Some tests failed. Check backend status.');
  }

  process.exit(failed === 0 ? 0 : 1);
}

runTests().catch((error) => {
  log(colors.red, `Fatal error: ${error.message}`);
  process.exit(1);
});
