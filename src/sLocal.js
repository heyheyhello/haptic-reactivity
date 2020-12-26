/* eslint-disable prefer-destructuring,no-multi-spaces */
let boxId = 0;
let reactionId = 0;

// Current reaction
let rxActive;
// To skip the subbed consistency check during an s(box) read
let sRead;
// Transactions
let transactionBoxes = new Set();

// Registry of reaction parents (and therefore all known reactions)
const rxTree = new WeakMap();

// Unique value to compare with `===` since Symbol() doesn't gzip well
const STATE_ON           = []; // Symbol();
const STATE_RUNNING      = []; // Symbol();
const STATE_PAUSED       = []; // Symbol();
const STATE_PAUSED_STALE = []; // Symbol();
const STATE_OFF          = []; // Symbol();
const BOX_NEXT_EMPTY     = []; // Symbol();

const createRx = (fn) => {
  const rx = () => _rxRun(rx);
  rx.id    = `R${reactionId++}=${fn.name}`;
  rx.fn    = fn;
  rx.sr    = new Set(); // Set<Box>
  rx.pr    = new Set(); // Set<Box>
  rx.runs  = 0;
  rx.inner = new Set(); // Set<Rx>
  rx.state = STATE_OFF;
  rx.pause = () => _rxPause(rx);
  rx.unsubscribe = () => _rxUnsubscribe(rx);
  // console.log(`Created ${rx.id}`, rxActive ? `; inner of ${rxActive.id}` : '');
  rxTree.set(rx, rxActive); // Maybe undefined; that's fine
  if (rxActive) rxActive.inner.push(rx);
  rx();
  return rx;
};

// This takes a meta object because honestly you shouldn't use it directly?
const _rxRun = (rx) => {
  if (rx.state === STATE_PAUSED) {
    // Never reached STATE_PAUSED_STALE so nothing's changed. There are still
    // subscriptions so return to STATE_ON. Inner reactions might update though
    rx.state = STATE_ON;
    rx.inner.forEach(_rxRun);
    return;
  }
  if (rx.state === STATE_RUNNING) {
    throw new Error(`Loop ${rx.id}`);
  }
  // Define the subscription function
  const s = box => {
    if (rx.pr.has(box)) {
      throw new Error(`Mixed pr/sr ${box.id}`);
    }
    // Add to box.rx first so it throws if s() wasn't passed a box...
    box.rx.add(rx);
    rx.sr.add(box);
    // console.log(`s() ${rx.id} 🔗 ${box.id}`);
    sRead = 1;
    const value = box();
    sRead = 0;
    return value;
  };
  // Drop everything in the tree like Sinuous/S.js "automatic memory management"
  // but skip if its the first run since there aren't any connections
  if (rx.runs++) {
    _rxUnsubscribe(rx);
  }
  rx.state = STATE_RUNNING;
  adopt(rx, () => rx.fn(s));
  rx.state = rx.sr.size ? STATE_ON : STATE_OFF;
  // console.log(`Run ${rx.runs}: ${rx.sr.size}sr ${rx.pr.size}pr`);
};

const _rxUnsubscribe = (rx) => {
  rx.state = STATE_OFF;
  rx.inner.forEach(_rxUnsubscribe);
  rx.inner = new Set();
  rx.sr.forEach(box => box.rx.delete(rx));
  rx.sr = new Set();
  rx.pr = new Set();
};

const _rxPause = (rx) => {
  rx.state = STATE_PAUSED;
  rx.inner.forEach(_rxPause);
};

const createBoxes = obj => {
  Object.keys(obj).forEach(k => {
    let saved = obj[k];
    const box = (...args) => {
      if (!args.length) {
        // if (rxActive) {
        //   console.log(sRead
        //     ? `Sub-read ${box.id}; rxActive ${rxActive.id}`
        //     : `Pass-read ${box.id}; rxActive ${rxActive.id}`
        //   );
        // }
        if (rxActive && !sRead) {
          if (rxActive.sr.has(box)) {
            throw new Error(`Mixed sr/pr ${box.id}`);
          }
          rxActive.pr.add(box);
        }
        return saved;
      }
      // Smaller bundle to use args[0] than destructing into a variable
      // console.log(`Write ${box.id}:`, saved, '➡', args[0], `Notifying ${box.rx.size} reactions`);
      if (transactionBoxes) {
        transactionBoxes.add(box);
        box.next = args[0];
        // Don't save
        return;
      }
      saved = args[0];
      // Duplicate the set else it's an infinite loop...
      // Needs to be ordered by parent->child
      const toRun = new Set(box.rx);
      toRun.forEach(rx => {
        const rxParent = rxTree.get(rx);
        if (rxParent && toRun.has(rxParent)) {
          // Parent has unsubscribed/removed this rx (rx.state === STATE_OFF)
          rx = rxParent;
        }
        if (rx.state === STATE_PAUSED) {
          rx.state = STATE_PAUSED_STALE;
        } else {
          _rxRun(rx);
        }
      });
      // Don't return a value; keep the API simple
    };
    box.id   = `B${boxId++}=${k}`;
    box.rx   = new Set();
    box.next = BOX_NEXT_EMPTY;
    obj[k]   = box;
  });
  return obj;
};

const transaction = (fn) => {
  const prev = transactionBoxes;
  transactionBoxes = new Set();
  let error;
  let value;
  try {
    value = fn();
  } catch (err) {
    error = err;
  }
  const boxes = transactionBoxes;
  transactionBoxes = prev;
  if (error) throw error;
  boxes.forEach(box => {
    // XXX: Sinuous does `if (box.next !== BOX_NEXT_EMPTY) { ... }` wrapper
    const { next } = box;
    box.next = BOX_NEXT_EMPTY;
    box(next);
  });
  return value;
};

const adopt = (rxParent, fn) => {
  const prev = rxActive;
  rxActive = rxParent;
  let error;
  let value;
  try {
    value = fn();
  } catch (err) {
    error = err;
  }
  rxActive = prev;
  if (error) throw error;
  return value;
};

export { createRx as rx, createBoxes as boxes, transaction, adopt, rxTree };
