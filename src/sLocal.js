let boxId = 0;
let reactionId = 0;

// Registry of reaction parents (and therefore all known reactions)
let rxParentLookup = new WeakMap();
// Current reaction
let rxActive = undefined;
// To skip the subbed consistency check during an s(box) read
let sRead = false;
// Transactions
let transactionQueue = [];

// Unique value to compare with `===` since Symbol() doesn't gzip well
const EMPTY_ARR = [];

// Reactions can be in one of these states
const state = {
  ON: 1,
  PAUSED: 2,
  PAUSED_STALE: 3,
  OFF: 4,
};

const createRx = (fn) => {
  const rx = () => _rxRun(rx);
  rx.id = `R${reactionId++}-${fn.name || '?'}`;
  rx.fn = fn;
  rx.sr = new Set(); // Set<Box>
  rx.pr = new Set(); // Set<Box>
  rx.runs = 0;
  rx.children = []; // Rx[]. Not a set because it's always small
  rx.state = state.ON;
  rx.pause = () => _rxPause(rx);
  rxParentLookup.set(rx, rxActive); // Maybe undefined; that's fine
  rx.unsubscribe = () => _rxUnsubscribe(rx);
  console.log(`Created ${rx.id}`, rxActive ? `; child of ${rxActive.id}` : '');
  if (rxActive) rxActive.children.add(rx);
  rx();
  return rx;
};

// This takes a meta object because honestly you shouldn't use it directly?
const _rxRun = (rx) => {
  if (rx.state === state.PAUSED) {
    // The reaction never reached PAUSED_STALE so nothing's changed. Maybe our
    // children need to update though:
    rx.state = state.ON;
    rx.children.forEach(_rxRun);
  }
  // Define the subscription function
  const s = box => {
    if (rx.pr.has(box)) throw new Error(`Mixed reads pr/sr ${box.id}`);
    // Add to box.rx first so it throws if s() wasn't passed a box...
    box.rx.add(rx);
    rx.sr.add(box);
    console.log(`s() ${rx.id} 🔗 ${box.id}`);
    sRead = true;
    const value = box();
    sRead = false;
    return value;
  };
  const prevActive = rxActive;
  rxActive = rx;
  // Drop everything in the tree like Sinuous'/S.js' automatic memory management
  _rxUnsubscribe(rx);
  let error;
  try {
    rx.fn(s);
    rx.runs++;
    rx.state = state.ON;
    console.log(`Run ${rx.runs}: ${rx.sr.size}/${rx.sr.size + rx.pr.size} reads subscribed`);
  } catch (err) {
    error = err;
  }
  rxActive = prevActive;
  if (error) throw error;
};

const _rxUnsubscribe = (rx) => {
  if (!rx.runs) {
    // There aren't any connections if the reaction has never run
    return;
  }
  rx.children.forEach(_rxUnsubscribe);
  rx.children = [];
  rx.sr.forEach(box => box.rx.delete(rx));
  rx.sr.clear();
  rx.pr.clear();
  rx.state = state.OFF;
};

const _rxPause = (rx) => {
  rx.children.forEach(_rxPause);
  rx.state = state.PAUSED;
};

const createBox = (k, v) => {
  // Hide the stored value in a closure and not as a property of the box
  let saved = v;
  const box = (...args) => {
    if (args.length) {
      const [nextValue] = args;
      console.log(`Write ${box.id}:`, saved, '➡', nextValue, `Notifying ${box.rx.size} reactions`);
      if (transactionQueue) {
        if (box.pending === EMPTY_ARR) {
          transactionQueue.push(box);
        }
        box.pending = nextValue;
        // Don't save
        return nextValue;
      }
      saved = nextValue;
      // Duplicate the set else it's an infinite loop...
      // Needs to be ordered by parent->child
      const toRun = new Set(box.rx);
      const runMaybe = (rx) => {
        if (rx.state === state.PAUSED) {
          rx.state = state.PAUSED_STALE;
        } else {
          _rxRun(rx);
        }
      };
      toRun.forEach(rx => {
        const rxParent = rxParentLookup.get(rx);
        if (rxParent && toRun.has(rxParent)) {
          runMaybe(rxParent);
          toRun.delete(rxParent);
          // Parent has unsubscribed (rx.state === state.OFF)
          // This rx has been superceded; unfortunately
          return;
        }
        runMaybe(rx);
      });
      // Don't return a value; keeps it simple
      return;
    }
    if (rxActive) {
      console.log(sRead
        ? `Sub-read ${box.id}; rxActive ${rxActive.id}`
        : `Pass-read ${box.id}; rxActive ${rxActive.id}`
      );
    }
    if (rxActive && !sRead) {
      if (rxActive.sr.has(box)) throw new Error(`Mixed reads sr/pr ${box.id}`);
      rxActive.pr.add(box);
    }
    return saved;
  };
  box.id = `B${boxId++}-${k || '?'}`;
  box.rx = new Set();
  box.pending = EMPTY_ARR;
  return box;
};

const createBoxes = obj => {
  Object.keys(obj).forEach(k => { obj[k] = createBox(k, obj[k]); });
  return obj;
};

const transaction = (fn) => {
  const prevTQ = transactionQueue;
  transactionQueue = [];
  const value = fn();
  const boxes = transactionQueue;
  transactionQueue = prevTQ;
  boxes.forEach(box => {
    if (box.pending !== EMPTY_ARR) {
      const { pending } = box;
      box.pending = EMPTY_ARR;
      box(pending);
    }
  });
  return value;
};

// export { live, createRx as rx, createBoxes as boxes };
module.exports = { rx: createRx, boxes: createBoxes, transaction };
