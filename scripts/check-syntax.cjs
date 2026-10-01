const path = require('node:path');
const { spawnSync } = require('node:child_process');
const distributions = require('./distributions.cjs');

for (const { file } of distributions) {
  const result = spawnSync(process.execPath, ['--check', path.join(__dirname, '..', file)], { stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
