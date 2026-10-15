import { spawnSync } from 'node:child_process';
for (const args of [['--test', 'tests/spark.rules.test.mjs'], ['--import', 'tsx', 'scripts/test-spark-integration.mjs']]) {
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', env: process.env });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
