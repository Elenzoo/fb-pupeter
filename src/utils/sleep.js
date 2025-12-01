function sleep(ms) {
  return new Promise((res) => setTimeout(res, ms));
}

function sleepRandom(minMs, maxMs) {
  const delta = maxMs - minMs;
  const extra = Math.random() * delta;
  return sleep(minMs + extra);
}

export { sleep, sleepRandom };
