let boxId = 0;
let reactionId = 0;

// Registry of reactions
let live = new Set();
// Current reaction
let rxActive = undefined;
// To skip the subbed consistency check during an s(box) read
let sRead = false;

const rx = (fn) => {
  const _rx = () => _rxRun(_rx);
  _rx.id = `R${reactionId++}:${fn.name || '<Anon>'}`;
  _rx.fn = fn;
  _rx.sr = new Set(); // Set<Box>
  _rx.pr = new Set(); // Set<Box>
  _rx.runs = 0;
  _rx.created = new Set(); // Set<ReactionMeta>
  _rx.unsubscribe = () => _rxUnsubscribe(_rx);
  console.log(`Create ${_rx.id}`);
  live.add(_rx);
  if (rxActive) {
    console.log(`${_rx.id} was created under ${rxActive.id}`);
    rxActive.created.add(_rx);
  }
  _rx();
  return _rx;
};

// This takes a meta object because honestly you shouldn't use it directly?
const _rxRun = (rx) => {
  // Define the subscription function
  const s = box => {
    if (rx.pr.has(box)) throw new Error(`Mixed reads ${box.id}`);
    // Add to box.rx first so it throws if s() wasn't passed a box...
    box.rx.add(rx);
    rx.sr.add(box);
    console.log(`s() ${rx.id} 🔗 ${box.id}`);
    sRead = true;
    const value = box();
    sRead = false;
    return value;
  };

  console.group(`Run ${rx.id}`);
  const prevActive = rxActive;
  rxActive = rx;
  // Drop everything in the tree like Sinuous'/S.js' automatic memory management
  _rxUnsubscribe(rx);
  let error;
  try {
    rx.fn(s);
    rx.runs++;
    if (rx.runs > 10) throw new Error();
    console.log(`Run ${rx.runs}: ${rx.sr.size}/${rx.sr.size + rx.pr.size} reads subscribed`);
  } catch (err) {
    error = err;
  }
  rxActive = prevActive;
  console.groupEnd(`Run ${rx.id}`);
  if (error) throw error;
};

const _rxUnsubscribe = (rx) => {
  if (rx.created.size) {
    rx.created.forEach(_rxUnsubscribe);
    rx.created = new Set();
  }
  rx.sr.forEach(box => box.rx.delete(rx));
  rx.sr = new Set();
  rx.pr = new Set();
};

const _box = (k, v) => {
  // Store in a closure and not a property of the box
  let saved = v;
  const box = (...args) => {
    if (args.length) {
      const [valueNext] = args;
      console.log(`Write ${box.id}:`, saved, '➡', valueNext, `Notifying ${box.rx.size} reactions`);
      saved = valueNext;
      // Duplicate the set else it's an infinite loop...
      new Set(box.rx).forEach(_rxRun);
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
      if (rxActive.sr.has(box)) throw new Error(`Mixed reads ${box.id}`);
      rxActive.pr.add(box);
    }
    return saved;
  };
  box.id = `B${boxId++}` + (k ? `:${k}` : '');
  box.rx = new Set();
  return box;
};

const boxes = obj => {
  Object.keys(obj).forEach(k => { obj[k] = _box(k, obj[k]); });
  return obj;
};

module.exports = { live, rx, boxes };
