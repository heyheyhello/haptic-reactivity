// Haptic's reactivity engine

// Implements the push-pull reactive programming model. Uses "Boxes" to store
// data and "Reaction" functions which do work. Reactions can read boxes in a
// neutral way, called a pass-read, or, in a way that subscribes them to box
// updates, called a subscribe-read. Writing a value to a box causes it to call
// all subscribed reactions (the push), even if the value hasn't changed. Each
// time a reaction runs it reads from boxes (pull). Its subscribe-reads are
// compared to those of its previous run and unused boxes are automatically
// unsubscribed. If there are no more subscriptions after a run then the
// reaction is removed. You can also remove a reaction manually. Reactions take
// down any children reactions which were created during their runs.

// Explicit subscriptions avoid accidental reaction calls that were an issue in
// Haptic's previous "Signal" reactivity model (from Sinuous/Solid/S.js)

// Unlike those libraries, there is no automatic memory management yet. There
// might not be. It seems wasteful to destroy all reaction linkings every run,
// but then again, it's also a lot of work to do consistency checks every run...

let boxId = 0
let reactionId = 0

let reactions = new Set()
// The reaction to bind subs in runReaction (and sFrom/sIgnore for surrogates)
let activeReaction = undefined

// To skip the reactionSubbedReads consistency check during an s(box) read
let flagSubRead = false
// To skip linking valid s/sFrom subs in surrogates to the upstream reaction
let flagIgnore = false

function createReaction(fn) {
  if (reactions.has(fn)) {
    throw new Error(`Function is already a reaction as ${fn.id}`)
  }
  fn.id = `R${reactionId++}:${fn.name || '<Anon>'}`
  fn.reactionSubbedReads = new Set() // Set<Box>
  fn.reactionPassedReads = new Set() // Set<Box>
  fn.runs = 0
  fn.reactionParent = activeReaction // or undefined
  fn.reactionChildren = new Set() // Set<Reaction>
  reactions.add(fn)
  const label = `Create ${fn.id}`
  console.group(label)
  if (activeReaction) {
    console.log(`Reaction lifetime scoped to its parent, ${activeReaction.id}`)
    activeReaction.reactionChildren.add(fn)
  }
  try {
    runReaction(fn)
  } catch (err) {
    // TODO? Bundle size...
    console.log('Thrown', err.message)
    console.log('Error during creation/run. Removing reaction...')
    removeReaction(fn)
  } finally {
    console.groupEnd(label)
  }
  return fn;
}

function runReaction(fn) {
  if (!reactions.has(fn)) {
    throw new Error(`Function isn't a reaction`)
  }
  const label = `Run ${fn.id}`
  console.group(label)
  const prevAR = activeReaction
  activeReaction = fn
  // For cleanup
  // TODO: Optimization to pass pointer to prevSubs then new Set() on fn.rSR?
  const prevSubs = new Set(fn.reactionSubbedReads)
  fn.reactionSubbedReads.clear()
  fn.reactionPassedReads.clear()
  try {
    fn()
    fn.runs++
    const sr = fn.reactionSubbedReads.size
    const pr = fn.reactionPassedReads.size
    console.log(`Run ${fn.runs}: ${sr}/${sr + pr} reads subscribed`)
    // If a reaction doesn't sub a previously subbed box then that box doesn't
    // need to run the reaction anymore
    fn.reactionSubbedReads.forEach(box => prevSubs.delete(box))
    prevSubs.forEach(box => {
      console.log(`Unsubscribing from unused box ${box.id}`)
      box.reactions.delete(fn)
    })
    // This operation is independent of the above work with prevSubs
    if (fn.reactionSubbedReads.size === 0) {
      removeReaction(fn)
    }
  } finally {
    activeReaction = prevAR // Important
    console.groupEnd(label)
  }
}

function removeReaction(fn) {
  console.log(`Removing reaction ${fn.id}`)
  if (fn.reactionParent) {
    fn.reactionParent.reactionChildren.delete(fn)
  }
  fn.reactionChildren.forEach(removeReaction)
  fn.reactionSubbedReads.forEach(box => box.reactions.delete(fn))
  // Remove the sets since they might be heavy
  delete fn.reactionChildren
  delete fn.reactionSubbedReads
  delete fn.reactionPassedReads
  // Leave the id, runs, parent, etc so people can see what run it ended on
  reactions.delete(fn)
}

function s(box) {
  if (!box.id || !box.reactions) {
    throw new Error(`s() Parameter isn't a box`)
  }
  if (!activeReaction) {
    throw new Error(`s() Can't subscribe; no active reaction`)
  }
  if (s.caller !== activeReaction) {
    throw new Error(`s() Can't subscribe; caller "${s.caller.name}" isn't the active/allowed reaction`)
  }
  console.log(`s() ${activeReaction.id} 🔗 ${box.id}`);
  if (activeReaction.reactionPassedReads.has(box)) {
    throw new Error(`Reaction ${activeReaction.id} can't subscribe-read to ${box.id} after pass-reading it; pick one`)
  }
  // Add after checking to be idempotent
  activeReaction.reactionSubbedReads.add(box)
  if (activeReaction.id !== 'CAPTURE') {
    // Skip this. We're in a no-commit mode right now in case consistency
    // checks throw, so this will be done in sFrom() after they all pass
    box.reactions.add(activeReaction)
  }
  flagSubRead = true
  const value = box()
  flagSubRead = false
  return value
}

function captureSubscriptions(fn) {
  // Create a fake surrogate reaction based on this given function
  if (fn.id) {
    throw new Error(`Can't capture subscriptions from a function that's already a reaction or box`)
  }
  fn.id = 'CAPTURE'
  fn.reactionSubbedReads = new Set()
  fn.reactionPassedReads = new Set()
  // Swap
  const realAR = activeReaction
  activeReaction = fn

  let capture;
  let value;
  try {
    value = fn()
    // If we made it this far without throwing an error then all consistency
    // checks passed ✅
    capture = fn.reactionSubbedReads;
    console.log(`Captured ${capture.size} subscriptions`)
  } finally {
    activeReaction = realAR
    delete fn.id
    delete fn.reactionSubbedReads
    delete fn.reactionPassedReads
    // TODO: Not happy about object passing as an intermediate...
    return { value, capture }
  }
}

function sFrom(fn) {
  if (!activeReaction) {
    throw new Error(`sFrom() Can't subscribe; no active reaction`)
  }
  console.group('sFrom')
  const { value, capture } = captureSubscriptions(fn)
  if (capture) {
    capture.forEach(box => {
      // Pass to real active reaction now that its been restored
      activeReaction.reactionSubbedReads.add(box)
      // Previously skipped in s() calls due to fn.id === 'CAPTURE'
      box.reactions.add(activeReaction)
    })
  }
  console.groupEnd('sFrom')
  return value
}

function sIgnore(fn) {
  console.group('sIgnore')
  // This is similar to "Do nothing" but if we actually do nothing then s() will
  // throw because it has no reaction to write to
  captureSubscriptions(fn)
  console.groupEnd('sIgnore')
}

function createBox(value, name) {
  // Store in a closure and not a property of the box
  // Reads should always be safe so there's no reason to backdoor it
  let saved = value
  const box = (...args) => {
    if (args.length) {
      const [valueNext] = args
      console.log(`Write ${box.id}:`, saved, '➡', valueNext, `Notifying ${box.reactions.size} reactions`)
      saved = valueNext
      box.reactions.forEach(runReaction)
      // Don't return a value. Keeps it simple if write doesn't also read
      return;
    }
    console.log(activeReaction
      ? flagSubRead
        ? `Sub-read ${box.id}; Active reaction ${activeReaction.id}`
        : `Pass-read ${box.id}; Active reaction ${activeReaction.id}`
      : `Pass-read ${box.id}. No active reaction`
    )
    if (activeReaction && !flagSubRead) {
      if (activeReaction.reactionSubbedReads.has(box)) {
        throw new Error(`Reaction ${activeReaction.id} can't pass-read ${box.id} after subscribe-reading it; pick one`)
      }
      // Add after checking to be idempotent
      activeReaction.reactionPassedReads.add(box)
    }
    return saved
  }
  box.id = `B${boxId++}` + (name ? `:${name}` : '');
  box.reactions = new Set();
  return box
}

function createNamedBoxes(bundle) {
  for (const [k,v] of Object.entries(bundle)) {
    bundle[k] = createBox(v, k);
  }
  return bundle
}

const data = createNamedBoxes({
  label: 'Default',
  count: 10,
  countMax: 100,
  list: ['Hi!'],
  wsMessages: [],
})

data.label('Something nice')
console.log('Get label:', data.label())
console.log('Get wsMessages:', data.wsMessages())

function addLog(msg) {
  data.wsMessages(data.wsMessages().concat(msg))
}

let logWrites = 0;
createReaction(function WriteLog() {
  console.log(`Here's the new log! WriteLog#${++logWrites}: ${s(data.wsMessages).length} items\n  - ${s(data.wsMessages).join('\n  - ')}`)
})

createReaction(function DoComputation() {
  addLog(`DoComputation is updating: ${data.count()}`)
  console.log(data.count() + data.list()[0] + s(data.label))
})

addLog('I can update the log and it calls WriteLog but leaves DoComp alone')
data.label('Writing a new label calls DoComp which then also calls WriteLog')

// Ok! Let's talk about nesting subscriptions and how to be informed and safe
// when calling functions from within your reactions

function DoSomeWork() {
  console.log('Trying to read from data.count')
  // This line makes this function a bit different. It's an s(...) outside of a
  // createReaction call, so DoSomeWork() throws an error. You have to either
  // pass this _directly_ into a createReaction or use sIgnore() or sFrom()
  const countA = s(data.count) * 10 + data.countMax()
  // Note that if the line was written without s(...) there's no issue. Then
  // this is just a normal function
  const countB = data.count() * 10 + data.countMax()
}

// This isn't bad tho! It's actually the main way Haptic does reactivity in JSX
// via <p>Hey {() => s(data.list).join(', ')}</p>. That's snippet isn't a
// reaction itself but is called later during a DOM updating reaction that uses
// the sFrom() method to register its subscriptions

// TODO: Next is to implement the OK-ing of subscriptions to values that would
// otherwise be "Not allowed" since caller !== activeReaction

// I think, like sRead, I'll have sAllowedCallers = new Set() and then on
// runReaction if activeReaction === undefined then that's in sAllowedCallers.
// All nested reactions/functions will _not_ be in sAllowedCallers unless
// explicitly s(...)'d in

// Remember that reactions have consistency restrictions for pass-reading or
// subscribe-reading reactive boxes. However, this is bordered at the function
// boundary. Each function call has its own consistency checks. If you have a
// subscribe-read to s(data.count) at the top level and then use SomeFunction()
// which has no subscriptions but does a pass-read to data.count(), that's OK.
// However, if SomeFunction contained an s() then you can't simply call it;
// you'll get an error. Instead you need to decide to use either sIgnore() or
// sFrom(). Using sIgnore frees you of any consistency checks and SomeFunction
// can be thought to contain no subscriptions. If you use sFrom, then the inner
// subscriptions are moved into your scope, so the consistency checks apply.
try {
  DoSomeWork() // Error as s(data.count); OK as data.count()
} catch (err) {
  console.log('Thrown', err.message)
}
try {
  sFrom(DoSomeWork) // Error since the resulting subscriptions have no reactions
} catch (err) {
  console.log('Thrown', err.message)
}
try {
  sIgnore(DoSomeWork) // OK. Error is due to consistency check failing in DoWork
} catch (err) {
  console.log('Thrown', err.message)
}
try {
  // Works as s(data.count); Useless as data.count()
  // Error for consistency check again
  createReaction(DoSomeWork)
} catch (err) {
  console.log('Thrown', err.message)
}

function DoSomeWorkFixed() {
  return s(data.count) * 10 + data.countMax()
}

createReaction(() => {
  const el = String(700 * sFrom(DoSomeWorkFixed) + '%')
  console.log('Reaction for DoSomeWorkFixed:', el)
})

data.count(data.count() + 1)

createReaction(() => {
  console.log('This one is interested in data.list, so it will sub to that')
  console.log(data.list().reduce((acc, now) => acc + String(now), ''))
  console.log(`Then I'll try to do some work`)

  // Safe: Any inner subscriptions will throw an error to make sure the dev is
  // informed when deciding how to proceed
  try {
    const countA = DoSomeWorkFixed()
  } catch (err) {
    console.log('CountA Thrown', err.message)
  }

  // Opt-out version: Doesn't throw for inner subscriptions; ignores s()/sFrom()
  // calls deeper in the tree
  try {
    const countB = sIgnore(DoSomeWorkFixed)
  } catch (err) {
    console.log('CountB Thrown', err.message)
  }

  // Opt-in version: Doesn't throw for inner subscriptions; s()/sFrom() calls
  // are subscribed to unless an sIgnore() is reached
  try {
    const countC = sFrom(DoSomeWorkFixed)
  } catch (err) {
    console.log('CountC Thrown', err.message)
  }
})
