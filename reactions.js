// Haptic's reactivity engine

// Implements the push-pull reactive programming model. Uses "Boxes" to store
// data and "Reaction" functions which do work. Reactions can read boxes in a
// neutral way, called a pass-read, or, in a way that subscribes them to box
// updates, called a subscribe-read. Writing a value to a box causes it to call
// all subscribed reactions (the push), even if the value hasn't changed. Each
// time a reaction runs it reads from boxes (pull). Its subscribe-reads are
// compared to those of its previous run and unused boxes are automatically
// unsubscribed. If there are no more subscriptions after a run then the
// reaction is deleted.

// Explicit subscriptions avoid accidental reaction calls that were an issue in
// Haptic's previous "Signal" reactivity model (from Sinuous/Solid/S.js)

let boxId = 0
let reactionId = 0

let reactions = new Set()
let activeReaction = undefined // `() => void` each runReaction()
let sRead = false

function createReaction(fn) {
  if (reactions.has(fn)) {
    throw 'Function is already a reaction'
  }
  if (activeReaction) {
    throw `Not allowed nested reactions; active one is ${activeReaction.id}`
  }
  fn.id = `R${reactionId++}:${fn.name || '<Anon>'}`
  fn.reactionSubReads = new Set() // Set<Box>
  fn.reactionPassReads = new Set() // Set<Box>
  fn.runs = 0
  reactions.add(fn)
  const label = `Create ${fn.id}`
  console.group(label)
  runReaction(fn)
  console.groupEnd(label)
  return fn;
}

function runReaction(fn) {
  if (!reactions.has(fn)) {
    throw `Function isn't a reaction`
  }
  const label = `Run ${fn.id}`
  console.group(label)
  const prev = activeReaction
  activeReaction = fn
  // For cleanup
  const prevSubs = new Set(fn.reactionSubReads)
  // TODO: This causes an infinite loop? Why?
  // fn.reactionSubReads.forEach(box => box.reactions.delete(fn) })
  fn.reactionSubReads.clear()
  fn.reactionPassReads.clear()
  fn()
  fn.runs++
  const sr = fn.reactionSubReads.size
  const pr = fn.reactionPassReads.size
  console.log(`Run ${fn.runs}: ${sr}/${sr + pr} reads subscribed`)
  activeReaction = prev
  // If a reaction doesn't sub a previously subbed box then that box doesn't
  // need to run the reaction anymore
  fn.reactionSubReads.forEach(box => prevSubs.delete(box))
  prevSubs.forEach(box => {
    console.log(`Unsubscribing from unused box ${box.id}`)
    box.reactions.delete(fn)
  })
  if (fn.reactionSubReads.size === 0) {
    removeReaction(fn)
  }
  console.groupEnd(label)
}

function removeReaction(fn) {
  reactions.delete(fn)
  // Leave the fn.id and fn.runs so people can see what run it ended on
  delete fn.reactionSubReads
  delete fn.reactionPassReads
}

function s(box) {
  // XXX: Depends if sIgnore() is removed and made implicit...
  if (!activeReaction) {
    throw `Can't subscribe to box; there's no active reaction`
  }
  console.log(`Checking subscription of ${s.caller.name} to ${box.id}`)
  console.log(s.caller === activeReaction
    ? ` - Ok! ${activeReaction.id} 🔗 ${box.id}`
    : ` - Not allowed, ${s.caller.name} is not the active reaction`
  )
  if (s.caller === activeReaction) {
    if (activeReaction.reactionPassReads.has(box)) {
      throw `Reaction ${activeReaction.id} can't subscribe-read to ${box.id} after pass-reading it; pick one`
    }
    // Add after checking to be idempotent
    activeReaction.reactionSubReads.add(box)
    box.reactions.add(activeReaction)
  }
  sRead = true
  const value = box()
  sRead = false
  return value
}

function createBox(value, name) {
  // Store in a closure and not a property of the box
  // Reads should always be safe so there's no reason to backdoor it
  let saved = value
  const box = (...args) => {
    if (args.length) {
      const [valueNext] = args
      console.log(`Set ${box.id}:`, saved, '➡', valueNext, `Notifying ${box.reactions.size} reactions`)
      saved = valueNext
      box.reactions.forEach(runReaction)
      // Don't return a value. Keeps it simple if SET doesn't also READ
      return;
    }
    console.log(activeReaction
      ? `Read ${box.id} with active reaction ${activeReaction.id}`
      : `Read ${box.id} with no active reaction`
    )
    if (activeReaction && !sRead) {
      if (activeReaction.reactionSubReads.has(box)) {
        throw `Reaction ${activeReaction.id} can't pass-read ${box.id} after subscribe-reading it; pick one`
      }
      // Add after checking to be idempotent
      activeReaction.reactionPassReads.add(box)
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
  return count
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

DoSomeWork() // Error as s(data.count); OK as data.count()
sIgnore(DoSomeWork) // OK. This is helpful for console debugging etc.
sFrom(DoSomeWork) // Error since the resulting subscriptions have no reactions
createReaction(DoSomeWork) // Works as s(data.count); Useless as data.count()

createReaction(() => document.appendChild(document.createTextNode(700 * sFrom(DoSomeWork) + '%')))
// TODO: Just make sure there's subscription consent all the way down the tree...

data.count(data.count() + 1)

createReaction(() => {
  console.log('This one is interested in data.list, so it will sub to that')
  console.log(data.list().reduce((acc, now) => acc + String(now), ''))
  console.log(`Then I'll try to do some work`)

  // Safe: Any inner subscriptions will throw an error to make sure the dev is
  // informed when deciding how to proceed
  const countA = DoSomeWork()

  // Opt-out version: Doesn't throw for inner subscriptions; ignores s()/sFrom()
  // calls deeper in the tree
  const countB = sIgnore(DoSomeWork)

  // Opt-in version: Doesn't throw for inner subscriptions; s()/sFrom() calls
  // are subscribed to unless an sIgnore() is reached
  const countC = sFrom(DoSomeWork)
})
