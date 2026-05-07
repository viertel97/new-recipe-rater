import { resolveMediaForLink } from "@/lib/media-store";

const MAX_CONCURRENT = 3;
let active = 0;
const queue: Array<() => void> = [];

function runNext() {
  if (active >= MAX_CONCURRENT || queue.length === 0) return;
  const job = queue.shift()!;
  active++;
  job();
}

function enqueue(linkId: string): void {
  queue.push(() => {
    resolveMediaForLink(linkId).finally(() => {
      active--;
      runNext();
    });
  });
  runNext();
}

export function scheduleMediaResolution(linkId: string): void {
  enqueue(linkId);
}
