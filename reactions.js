// Signals

let pushboxId = 0
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
  fn.pushboxSubReads = new Set()
  fn.pushboxPassReads = new Set()
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
  const prevSubs = new Set(fn.pushboxSubReads)
  // TODO: This causes an infinite loop? Why?
  // fn.pushboxSubReads.forEach(pushbox => pushbox.reactions.delete(fn) })
  fn.pushboxSubReads.clear()
  fn.pushboxPassReads.clear()
  fn()
  fn.runs++
  const sr = fn.pushboxSubReads.size
  const pr = fn.pushboxPassReads.size
  // ASSUMPTION: If a reaction runs and doesn't sub a previously subbed pushbox
  // then that box doesn't need to run the reaction anymore
  fn.pushboxSubReads.forEach(pushbox => {
    if (prevSubs.delete(pushbox)) {
      console.log(`Unsubscribing from pushbox ${pushbox.id}`)
      pushbox.reactions.delete(fn)
    }
  })
  console.log(`Run ${fn.runs}: ${sr}/${sr + pr} reads subscribed`)
  activeReaction = prev
  console.groupEnd(label)
}

function s(pushbox) {
  if (!activeReaction) {
    throw `Can't subscribe to pushbox; there's no active reaction`
  }
  const caller = arguments.callee.caller

  console.log(`Checking subscription of ${caller.name} to ${pushbox.id}`)
  console.log(caller === activeReaction
    ? ` - Ok! ${activeReaction.id} 🔗 ${pushbox.id}`
    : ` - Not allowed, ${caller.name} is not the active reaction`
  )
  if (caller === activeReaction) {
    if (activeReaction.pushboxPassReads.has(pushbox)) {
      throw `Reaction ${activeReaction.id} can't subscribe-read to ${pushbox.id} after pass-reading it; pick one`
    }
    // Add after checking to be idempotent
    activeReaction.pushboxSubReads.add(pushbox)
    pushbox.reactions.add(activeReaction)
  }
  sRead = true
  const value = pushbox()
  sRead = false
  return value
}

function createPushbox(value, name) {
  // Store in a closure and not a property of the pushbox
  // Reads should always be safe so there's no reason to backdoor it
  let saved = value
  const pushbox = (...args) => {
    if (args.length) {
      const [valueNext] = args
      console.log(`Set ${pushbox.id}:`, saved, '➡', valueNext, `Notifying ${pushbox.reactions.size} reactions`)
      saved = valueNext
      pushbox.reactions.forEach(runReaction)
      // Don't return a value. Keeps it simple if SET doesn't also READ
      return;
    }
    console.log(activeReaction
      ? `Read ${pushbox.id} with active reaction ${activeReaction.id}`
      : `Read ${pushbox.id} with no active reaction`
    )
    if (activeReaction && !sRead) {
      if (activeReaction.pushboxSubReads.has(pushbox)) {
        throw `Reaction ${activeReaction.id} can't pass-read ${pushbox.id} after subscribe-reading it; pick one`
      }
      // Add after checking to be idempotent
      activeReaction.pushboxPassReads.add(pushbox)
    }
    return saved
  }
  pushbox.id = `P${pushboxId++}` + (name ? `:${name}` : '');
  pushbox.reactions = new Set();
  return pushbox
}

function createPushboxes(bundle) {
  for (const [k,v] of Object.entries(bundle)) {
    bundle[k] = createPushbox(v, k);
  }
  return bundle
}

const data = createPushboxes({
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

// Hmm ok. So. Do I make it that DoSomeWork() fails but then if I do
// s(DoSomeWork) does that subscribe to data.count()?... Seems weird.
function DoSomeWork() {
  console.log('Trying to read from data.count')
  // This line is sketchy. It's s() outside of a createReaction call...
  const countA = s(data.count) * 10 + data.countMax()
  const countB = data.count() * 10 + data.countMax()
  return count
}

// Another case to check... If I s(data.count) outside, and then call DoSomeWork
// which does a read data.count() then does that throw the error about
// consistency issues? Then what about s(DoSomeWork) case? Maybe s(Fn, [pushbox])

DoSomeWork() // Error as s(data.count); OK as data.count()
createReaction(DoSomeWork) // Works as s(data.count); Useless as data.count()

createReaction(() => s(DoSomeWork)) // If s(data.count) ... hmm. I think throw. No nests!
createReaction(() => s(DoSomeWork, [data.count]))
createReaction(() => s(DoSomeWork, [data.count, data.countMax])) // === s(DoSomeWork)

data.count(data.count() + 1)

createReaction(() => {
  console.log('This one is interested in data.list, so it will sub to that')
  console.log(data.list().reduce((acc, now) => acc + String(now), ''))
  console.log(`Then I'll try to do some work`)
  // Safe
  const countA = DoSomeWork()
  // Opt-in subscribe version
  const countB = s(DoSomeWork)
})
