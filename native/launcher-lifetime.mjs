// Rust keeps the write end of this private pipe in its owned Child handle.
// EOF also arrives when the launcher is killed by the development watcher.
let stopping = false;
function stop() {
  if (stopping) return;
  stopping = true;
  // Allow upstream's SIGTERM handler to flush data, but bound shutdown time.
  setTimeout(() => process.exit(0), 3000).unref();
  process.kill(process.pid, "SIGTERM");
}
// Node workers inherit --import but do not own the launcher's pipe.
if (isMainThread) {
  process.stdin.once("end", stop);
  process.stdin.once("error", stop);
  process.stdin.resume();
}
import { isMainThread } from "node:worker_threads";
