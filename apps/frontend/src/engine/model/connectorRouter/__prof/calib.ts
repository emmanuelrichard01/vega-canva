// A fixed workload: 2M heap-ish float ops. On an idle 2020s laptop this takes about 4ms.
function baseline() { let x = 0; const a = new Float64Array(1024); for (let i = 0; i < 2_000_000; i++) { a[i & 1023] = a[(i * 7) & 1023] * 0.5 + i; x += a[i & 1023]; } return x; }
for (let i = 0; i < 5; i++) baseline();
const t0 = performance.now(); for (let i = 0; i < 20; i++) baseline(); console.log('baseline ms', ((performance.now() - t0) / 20).toFixed(2));
