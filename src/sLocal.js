/* eslint-disable prefer-destructuring,no-multi-spaces */
let boxId = 0;
let reactionId = 0;
let rxActive;         // Current reaction
let sRead;            // Skip the read consistency check during s(box)
let transactionBatch; // Boxes written to during a transaction(() => {...})

// Registry of reaction parents (and therefore all known reactions)
const rxTree = new WeakMap();

// Unique value to compare with `===` since Symbol() doesn't gzip well
const STATE_ON           = [];
const STATE_RUNNING      = [];
const STATE_PAUSED       = [];
const STATE_PAUSED_STALE = [];
const STATE_OFF          = [];

const createRx = (fn) => {
  const rx = () => _rxRun(rx);
  rx.id = `R${reactionId++}=${fn.name}`;
  rx.fn = fn;
  rx.runs = 0;
  // Other properties are setup in rx()>_rxRun()>_rxUnsubscribe()
  rx.pause = () => _rxPause(rx);
  rx.unsubscribe = () => _rxUnsubscribe(rx);
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
  // Drop everything in the tree like Sinuous/S.js "automatic memory management"
  // but skip if its the first run since there aren't any connections
  _rxUnsubscribe(rx);
  rx.state = STATE_RUNNING;
  // Define the subscription function, s, as a parameter to rx.fn()
  adopt(rx, () => rx.fn(box => {
    if (rx.pr.has(box)) {
      throw new Error(`Mixed pr/sr ${box.id}`);
    }
    // Use box.rx first so it throws if s() wasn't passed a box
    box.rx.add(rx);
    rx.sr.add(box);
    sRead = 1;
    const value = box();
    sRead = 0;
    return value;
  }));
  rx.runs++;
  rx.state = rx.sr.size ? STATE_ON : STATE_OFF;
};

const _rxUnsubscribe = (rx) => {
  rx.state = STATE_OFF;
  if (rx.runs) {
    // These are only defined once the reaction has been setup and run before
    rx.inner.forEach(_rxUnsubscribe);
    rx.sr.forEach(box => box.rx.delete(rx));
  }
  rx.sr = new Set();
  rx.pr = new Set();
  rx.inner = new Set();
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
        if (rxActive && !sRead) {
          if (rxActive.sr.has(box)) {
            throw new Error(`Mixed sr/pr ${box.id}`);
          }
          rxActive.pr.add(box);
        }
        return saved;
      }
      if (transactionBatch) {
        transactionBatch.add(box);
        // Bundle size: args[0] is smaller than destructing
        box.next = args[0];
        // Don't save
        return;
      }
      saved = args[0];
      // Duplicate the set else it's an infinite loop...
      const toRun = new Set(box.rx);
      toRun.forEach(rx => {
        // Calls are ordered by parent->child
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
      // Boxes don't return the value on write, unlike Sinuous/S.js
    };
    box.id = `B${boxId++}=${k}`;
    box.rx = new Set();
    obj[k] = box;
  });
  return obj;
};

const transaction = (fn) => {
  const prev = transactionBatch;
  transactionBatch = new Set();
  let error;
  let value;
  try {
    value = fn();
  } catch (err) {
    error = err;
  }
  const boxesWritten = transactionBatch;
  transactionBatch = prev;
  if (error) throw error;
  boxesWritten.forEach(box => {
    box(box.next);
    delete box.next;
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
