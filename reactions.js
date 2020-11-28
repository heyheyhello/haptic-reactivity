// Signals

let pushboxId = 0
let reactionId = 0

let reactions = new Set()
let activeReaction = undefined // `() => void` each runReaction()
let activeReactionReads = undefined // `new Set()` each runReaction()
let sAllowRead = false

function createReaction(fn) {
  if (reactions.has(fn)) {
    throw 'Function is already a reaction'
  }
  if (activeReaction) {
    throw `Not allowed nested reactions; active one is ${activeReaction.id}`
  }
  fn.id = `R${reactionId++}:${fn.name || '<Anon>'}`
  // TODO: Naming? Publisher. Sender. Messenger. Informer. Communicator...
  // Lots of synonymns but I want to convey that it doesn't _take_ a value from
  // somewhere, like a postee would take from a mailbox - it _is_ also the box
  fn.pushboxes = new Set()
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
  // TODO: Unsubscribe and rebuild subs
  const prevAR = activeReaction
  const prevARR = activeReactionReads
  activeReaction = fn
  // XXX: This means the system is now less inspectable? Is that worth it...
  activeReactionReads = new Set()
  fn()
  fn.runs++
  const reads = activeReactionReads.size
  console.log(`Run ${fn.runs}: ${fn.pushboxes.size}/${fn.pushboxes.size + reads} reads subscribed`)
  activeReaction = prevAR
  activeReactionReads = prevARR // GC the Set()
  console.groupEnd(label)
}

function s(pushbox) {
  if (!activeReaction) {
    throw `Can't subscribe to pushbox; there's no active reaction`
  }
  const caller = arguments.callee.caller
  console.log(`Maybe subscribe ${caller.name} to ${pushbox.id}?`)
  if (caller === activeReaction) {
    console.log(`  Yes! ${activeReaction.id} 🔗 ${pushbox.id}`)
    if (activeReactionReads.has(pushbox)) {
      throw `Reaction ${activeReaction.id} can't subscribe to ${pushbox.id} after reading it; pick one`
    }
    // Add after checking to be idempotent
    activeReaction.pushboxes.add(pushbox)
    pushbox.reactions.add(activeReaction)
  } else {
    console.log(`  No, ${caller.name} is not the active reaction`)
  }
  ignoreReadForSubscription = true
  const valueToFwd = pushbox()
  ignoreReadForSubscription = false
  return valueToFwd
}

function createPushbox(value, name) {
  const pushbox = (...args) => {
    if (args.length) {
      const [valueNext] = args
      console.log(`SET ${pushbox.id}:`, pushbox.value, '➡', valueNext, `Notifying ${pushbox.reactions.size} reactions`)
      pushbox.value = valueNext
      pushbox.reactions.forEach(runReaction)
      // Don't return a value. Keeps it simple if SET doesn't also READ
      return;
    }
    if (activeReaction) {
      console.log(`READ ${pushbox.id} with active reaction ${activeReaction.id}`)
      if (ignoreReadForSubscription === false) {
        if (activeReaction.pushboxes.has(pushbox)) {
          throw `Reaction ${activeReaction.id} can't read ${pushbox.id} after subscribing to it; pick one`
        }
        // Add after checking to be idempotent
        activeReactionReads.add(pushbox)
      }
    } else {
      console.log(`READ ${pushbox.id} with no active reaction`)
    }
    return pushbox.value
  }
  pushbox.id = `P${pushboxId++}` + (name ? `:${name}` : '');
  pushbox.value = value
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
