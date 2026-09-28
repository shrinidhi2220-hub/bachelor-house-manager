const base = process.argv[2];
const total = Math.max(1, Number(process.argv[3] || 1000));
const concurrency = Math.max(1, Number(process.argv[4] || 100));
if (!base) {
  console.error('Usage: node ops/load-test.mjs https://your-api.example.com/api/health 1000 100');
  process.exit(1);
}
let nextIndex = 0;
let completed = 0;
let failed = 0;
const started = Date.now();
async function worker(){
  while (true) {
    const index = nextIndex++;
    if (index >= total) return;
    try {
      const r = await fetch(base);
      if (!r.ok) failed++; else completed++;
    } catch {
      failed++;
    }
  }
}
await Promise.all(Array.from({ length: Math.min(concurrency, total) }, worker));
const seconds=(Date.now()-started)/1000;
console.log(JSON.stringify({total,concurrency,completed,failed,durationSeconds:Number(seconds.toFixed(2)),requestsPerSecond:Number((total/seconds).toFixed(1))},null,2));
