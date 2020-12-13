let boxId = 0;
let reactionId = 0;

let reactions = new Set();
// The reaction to bind subs in runReaction (and sFrom/sIgnore for surrogates)
let activeReaction = undefined;
// To skip the reactionSubbedReads consistency check during an s(box) read
let flagSubRead = false;

function createReaction(fn) {
  if (reactions.has(fn)) {
    throw new Error(`Function is already a reaction as ${fn.id}`);
  }
  fn.id = `R${reactionId++}:${fn.name || '<Anon>'}`;
  fn.reactionSubbedReads = new Set(); // Set<Box>
  fn.reactionPassedReads = new Set(); // Set<Box>
  fn.runs = 0;
  fn.reactionParent = activeReaction; // or undefined
  fn.reactionChildren = new Set(); // Set<Reaction>
  reactions.add(fn);
  const label = `Create ${fn.id}`;
  console.group(label);
  if (activeReaction) {
    console.log(`Reaction lifetime scoped to its parent, ${activeReaction.id}`);
    activeReaction.reactionChildren.add(fn);
  }
  try {
    runReaction(fn);
  } catch (err) {
    // TODO? Bundle size...
    console.log('Thrown', err.message);
    console.log('Error during creation/run. Removing reaction...');
    removeReaction(fn);
  } finally {
    console.groupEnd(label);
  }
  return fn;
}

function runReaction(fn) {
  if (!reactions.has(fn)) {
    throw new Error('Function isn\'t a reaction');
  }
  const label = `Run ${fn.id}`;
  console.group(label);
  const prevAR = activeReaction;
  activeReaction = fn;
  // For cleanup
  // TODO: Optimization to pass pointer to prevSubs then new Set() on fn.rSR?
  const prevSubs = new Set(fn.reactionSubbedReads);
  fn.reactionSubbedReads.clear();
  fn.reactionPassedReads.clear();
  try {
    fn();
    fn.runs++;
    const sr = fn.reactionSubbedReads.size;
    const pr = fn.reactionPassedReads.size;
    console.log(`Run ${fn.runs}: ${sr}/${sr + pr} reads subscribed`);
    // If a reaction doesn't sub a previously subbed box then that box doesn't
    // need to run the reaction anymore
    fn.reactionSubbedReads.forEach(box => prevSubs.delete(box));
    prevSubs.forEach(box => {
      console.log(`Unsubscribing from unused box ${box.id}`);
      box.reactions.delete(fn);
    });
    // This operation is independent of the above work with prevSubs
    if (fn.reactionSubbedReads.size === 0) {
      removeReaction(fn);
    }
  } finally {
    activeReaction = prevAR; // Important
    console.groupEnd(label);
  }
}

function removeReaction(fn) {
  console.log(`Removing reaction ${fn.id}`);
  if (fn.reactionParent) {
    fn.reactionParent.reactionChildren.delete(fn);
  }
  fn.reactionChildren.forEach(removeReaction);
  fn.reactionSubbedReads.forEach(box => box.reactions.delete(fn));
  // Remove the sets since they might be heavy
  delete fn.reactionChildren;
  delete fn.reactionSubbedReads;
  delete fn.reactionPassedReads;
  // Leave the id, runs, parent, etc so people can see what run it ended on
  reactions.delete(fn);
}

function s(box) {
  if (!box.id || !box.reactions) {
    throw new Error('s() Parameter isn\'t a box');
  }
  if (!activeReaction) {
    throw new Error('s() Can\'t subscribe; no active reaction');
  }
  if (s.caller !== activeReaction) {
    throw new Error(`s() Can't subscribe; caller "${s.caller.name}" isn't the active/allowed reaction`);
  }
  console.log(`s() ${activeReaction.id} 🔗 ${box.id}`);
  if (activeReaction.reactionPassedReads.has(box)) {
    throw new Error(`Reaction ${activeReaction.id} can't subscribe-read to ${box.id} after pass-reading it; pick one`);
  }
  // Add after checking to be idempotent
  activeReaction.reactionSubbedReads.add(box);
  if (activeReaction.id !== 'CAPTURE') {
    // Skip this. We're in a no-commit mode right now in case consistency
    // checks throw, so this will be done in sFrom() after they all pass
    box.reactions.add(activeReaction);
  }
  flagSubRead = true;
  const value = box();
  flagSubRead = false;
  return value;
}

function captureSubscriptions(fn) {
  // Create a fake surrogate reaction based on this given function
  if (fn.id) {
    throw new Error('Can\'t capture subscriptions from a function that\'s already a reaction or box');
  }
  fn.id = 'CAPTURE';
  fn.reactionSubbedReads = new Set();
  fn.reactionPassedReads = new Set();
  // Swap
  const realAR = activeReaction;
  activeReaction = fn;

  let capture;
  let value;
  try {
    value = fn();
    // If we made it this far without throwing an error then all consistency
    // checks passed ✅
    capture = fn.reactionSubbedReads;
    console.log(`Captured ${capture.size} subscriptions`);
  } finally {
    activeReaction = realAR;
    delete fn.id;
    delete fn.reactionSubbedReads;
    delete fn.reactionPassedReads;
    // TODO: Not happy about object passing as an intermediate...
    // Also wow neat! ESLint telling me good stuff...
    // eslint-disable-next-line no-unsafe-finally
    return { value, capture };
  }
}

function sFrom(fn) {
  if (!activeReaction) {
    throw new Error('sFrom() Can\'t subscribe; no active reaction');
  }
  console.group('sFrom');
  const { value, capture } = captureSubscriptions(fn);
  if (capture) {
    capture.forEach(box => {
      // Pass to real active reaction now that its been restored
      activeReaction.reactionSubbedReads.add(box);
      // Previously skipped in s() calls due to fn.id === 'CAPTURE'
      box.reactions.add(activeReaction);
    });
  }
  console.groupEnd('sFrom');
  return value;
}

function sIgnore(fn) {
  console.group('sIgnore');
  // This is similar to "Do nothing" but if we actually do nothing then s() will
  // throw because it has no reaction to write to
  captureSubscriptions(fn);
  console.groupEnd('sIgnore');
}

function createBox(value, name) {
  // Store in a closure and not a property of the box
  // Reads should always be safe so there's no reason to backdoor it
  let saved = value;
  const box = (...args) => {
    if (args.length) {
      const [valueNext] = args;
      console.log(`Write ${box.id}:`, saved, '➡', valueNext, `Notifying ${box.reactions.size} reactions`);
      saved = valueNext;
      box.reactions.forEach(runReaction);
      // Don't return a value. Keeps it simple if write doesn't also read
      return;
    }
    console.log(activeReaction
      ? flagSubRead
        ? `Sub-read ${box.id}; Active reaction ${activeReaction.id}`
        : `Pass-read ${box.id}; Active reaction ${activeReaction.id}`
      : `Pass-read ${box.id}. No active reaction`
    );
    if (activeReaction && !flagSubRead) {
      if (activeReaction.reactionSubbedReads.has(box)) {
        throw new Error(`Reaction ${activeReaction.id} can't pass-read ${box.id} after subscribe-reading it; pick one`);
      }
      // Add after checking to be idempotent
      activeReaction.reactionPassedReads.add(box);
    }
    return saved;
  };
  box.id = `B${boxId++}` + (name ? `:${name}` : '');
  box.reactions = new Set();
  return box;
}

function createNamedBoxes(bundle) {
  for (const [k, v] of Object.entries(bundle)) {
    bundle[k] = createBox(v, k);
  }
  return bundle;
}

module.exports = {
  reactions,
  createReaction,
  removeReaction,
  createBox,
  createNamedBoxes,
  s,
  sFrom,
  sIgnore,
};
