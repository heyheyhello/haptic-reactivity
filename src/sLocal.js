/* eslint-disable prefer-destructuring,no-multi-spaces */
let vocalId = 0;
let reactionId = 0;
let rxActive;         // Current reaction
let sRead;            // Skip the read consistency check during s(vocal)
let transactionBatch; // Boxes written to during a transaction(() => {...})

// Registry of reaction parents (and therefore all known reactions)
const rxTree = new WeakMap();

// Unique value to compare with `===` since Symbol() doesn't gzip well
const STATE_ON           = [];
const STATE_RUNNING      = [];
const STATE_PAUSED       = [];
const STATE_PAUSED_STALE = [];
const STATE_OFF          = [];

const rxCreate = (fn) => {
  const rx = () => _rxRun(rx);
  rx.id = `rx-${reactionId++}-${fn.name}`;
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
  if (rx.state === STATE_RUNNING) {
    throw new Error(`Loop ${rx.id}`);
  }
  // If STATE_PAUSED then STATE_PAUSED_STALE was never reached; nothing has
  // changed. Restore state (below) and call inner reactions so they can check
  if (rx.state === STATE_PAUSED) {
    rx.inner.forEach(_rxRun);
  } else {
    // Symmetrically remove all connections from rx/vocals. This is "automatic
    // memory management" in Sinuous/S.js
    _rxUnsubscribe(rx);
    rx.state = STATE_RUNNING;
    // Define the subscription function, s(vocal), as a parameter to rx.fn()
    adopt(rx, () => rx.fn(vocal => {
      if (rx.pr.has(vocal)) {
        throw new Error(`Mixed pr/sr ${vocal.id}`);
      }
      // Symmetrically link. Use vocal.rx to throw if s() wasn't passed a vocal
      vocal.rx.add(rx);
      rx.sr.add(vocal);
      sRead = 1;
      const value = vocal();
      sRead = 0;
      return value;
    }));
    rx.runs++;
  }
  rx.state = rx.sr.size ? STATE_ON : STATE_OFF;
};

const _rxUnsubscribe = (rx) => {
  rx.state = STATE_OFF;
  // This is skipped for newly created reactions
  if (rx.runs) {
    // These are only defined once the reaction has been setup and run before
    rx.inner.forEach(_rxUnsubscribe);
    rx.sr.forEach(v => v.rx.delete(rx));
  }
  rx.sr = new Set();
  rx.pr = new Set();
  rx.inner = new Set();
};

const _rxPause = (rx) => {
  rx.state = STATE_PAUSED;
  rx.inner.forEach(_rxPause);
};

const vocalsCreate = obj => {
  Object.keys(obj).forEach(k => {
    let saved = obj[k];
    const vocal = (...args) => {
      if (!args.length) {
        if (rxActive && !sRead) {
          if (rxActive.sr.has(vocal)) {
            throw new Error(`Mixed sr/pr ${vocal.id}`);
          }
          rxActive.pr.add(vocal);
        }
        return saved;
      }
      if (transactionBatch) {
        transactionBatch.add(vocal);
        // Bundle size: args[0] is smaller than destructing
        vocal.next = args[0];
        // Don't save
        return;
      }
      saved = args[0];
      // Duplicate the set else it's an infinite loop...
      const toRun = new Set(vocal.rx);
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
    vocal.id = `vocal-${vocalId++}-${k}`;
    vocal.rx = new Set();
    obj[k] = vocal;
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
  const vocals = transactionBatch;
  transactionBatch = prev;
  if (error) throw error;
  vocals.forEach(v => {
    v(v.next);
    delete v.next;
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

export { rxCreate as rx, vocalsCreate as vocals, transaction, adopt, rxTree };
