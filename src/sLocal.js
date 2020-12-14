let boxId = 0;
let reactionId = 0;

// Registry of functions to reaction metadata objects
let live = new Map();
// The reaction meta info to bind subs in runReaction
let rxActive = undefined;
// To skip the subbed consistency check during an s(box) read
let sRead = false;

function rx(fn) {
  if (live.has(fn)) {
    throw new Error('Already a live reaction');
  }
  const meta = {
    id: `R${reactionId++}:${fn.name || '<Anon>'}`,
    rx: fn,
    subbed: new Set(),     // Set<Box>
    passed: new Set(),     // Set<Box>
    runs: 0,
    rxParent: rxActive,    // ReactionMeta || undefined
    rxChildren: new Set(), // Set<ReactionMeta>
  };
  // TODO: How is this registry working?
  live.set(fn, meta);
  console.group(`Create ${meta.id}`);
  if (rxActive) {
    console.log(`Reaction lifetime scoped to its parent, ${rxActive.id}`);
    rxActive.rxChildren.add(meta);
  }
  let error;
  try {
    _rxRun(meta);
  } catch (err) {
    console.log(`Creation error: ${err.message}}`);
    _rxUnsubscribe(meta);
    error = err;
  }
  console.groupEnd(`Create ${meta.id}`);
  if (error) throw error;

  const _rx = () => _rxRun(meta);
  _rx.unsubscribe = () => _rxUnsubscribe(meta);
  _rx.meta = meta;
  return _rx;
}

// This takes a meta object because honestly you shouldn't use it directly?
function _rxRun(meta) {
  console.group(`Run ${meta.id}`);
  const prevActive = rxActive;
  rxActive = meta;
  // For cleanup later. Save work via pointer move instead of duplicating set
  const prevSubs = meta.subbed;
  meta.subbed = new Set();
  meta.passed.clear();

  // Define the subscription function
  const s = box => {
    if (!box.id || !box.reactions) {
      throw new Error('s() Parameter isn\'t a box');
    }
    console.log(`s() ${meta.id} 🔗 ${box.id}`);
    if (meta.passed.has(box)) {
      throw new Error(`Reaction ${meta.id} can't subscribe-read to ${box.id} after pass-reading it; pick one`);
    }
    // Add after checking to be idempotent
    meta.subbed.add(box);
    box.reactions.add(meta);
    sRead = true;
    const value = box();
    sRead = false;
    return value;
  };

  let error;
  try {
    meta.rx(s);
    meta.runs++;
    console.log(`Run ${meta.runs}: ${meta.subbed.size}/${meta.subbed.size + meta.passed.size} reads subscribed`);
    // If a reaction doesn't sub a previously subbed box then that box doesn't
    // need to run the reaction anymore
    meta.subbed.forEach(box => prevSubs.delete(box));
    prevSubs.forEach(box => {
      console.log(`Unsubscribing from unused box ${box.id}`);
      box.reactions.delete(meta);
    });
    // This operation is independent of the above work with prevSubs
    if (meta.subbed.size === 0) {
      _rxUnsubscribe(meta);
    }
  } catch (err) {
    error = err;
  }
  rxActive = prevActive;
  console.groupEnd(`Run ${meta.id}`);
  if (error) throw error;
}

function _rxUnsubscribe(meta) {
  console.log(`Unsubscribing reaction ${meta.id}`);
  if (meta.rxParent) {
    meta.rxParent.rxChildren.delete(meta);
  }
  meta.rxChildren.forEach(_rxUnsubscribe);
  meta.subbed.forEach(box => box.reactions.delete(meta));
}

function _box(k, v) {
  // Store in a closure and not a property of the box
  // Reads should always be safe so there's no reason to backdoor it
  let saved = v;
  const box = (...args) => {
    if (args.length) {
      const [valueNext] = args;
      console.log(`Write ${box.id}:`, saved, '➡', valueNext, `Notifying ${box.reactions.size} reactions`);
      saved = valueNext;
      box.reactions.forEach(_rxRun);
      // Don't return a value. Keeps it simple if write doesn't also read
      return;
    }
    if (rxActive) {
      console.log(sRead
        ? `Sub-read ${box.id}; rxActive ${rxActive.id}`
        : `Pass-read ${box.id}; rxActive ${rxActive.id}`
      );
    }
    if (rxActive && !sRead) {
      if (rxActive.subbed.has(box)) {
        throw new Error(`Reaction ${rxActive.id} can't pass-read ${box.id} after subscribe-reading it; pick one`);
      }
      // Add after checking to be idempotent
      rxActive.passed.add(box);
    }
    return saved;
  };
  box.id = `B${boxId++}` + (k ? `:${k}` : '');
  box.reactions = new Set();
  return box;
}

function boxes(bundle) {
  for (const [k, v] of Object.entries(bundle)) {
    bundle[k] = _box(k, v);
  }
  return bundle;
}

module.exports = {
  live,
  rx,
  boxes,
};
