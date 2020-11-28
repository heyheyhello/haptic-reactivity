// Signals

let pubId = 0
let reactionId = 0

let reaction = undefined
let reactionMeta = new Map()
let sAllowRead = false

function createReaction(fn) {
  const meta = {
    id: `R${reactionId++} ${fn.name || '<Anon>'}`,
    subPubs: new Set(),
    readPubs: new Set(),
    runCount: 0,
  };
  reactionMeta.set(fn, meta)
  const label = `Create ${meta.id}`
  console.group(label)
  if (reaction) {
    reactionMeta.delete(reaction)
    throw `Not allowed nested reactions; active one is ${meta.id}`
  }
  runReaction(fn)
  console.groupEnd(label)
  return fn;
}

function runReaction(fn) {
  const meta = reactionMeta.get(fn);
  if (!meta) {
    throw `No such reaction for given function`
  }
  const label = `Run ${meta.id}`
  // TODO: Unsubscribe and rebuild subPubs
  const reactionPrev = reaction
  reaction = fn
  console.group(label)
  fn()
  reaction = reactionPrev
  meta.runCount++
  console.log(`Runs ${meta.runCount}; SubPubs ${meta.subPubs.size}; ReadPubs ${meta.readPubs.size}`)
  console.groupEnd(label)
}

function s(pub) {
  if (!reaction) {
    throw 'No active reaction to subscribe a publisher to'
  }
  const caller = arguments.callee.caller
  console.log(`Maybe subcribe ${pub.id} to ${caller.name}?`)
  if (caller === reaction) {
    const meta = reactionMeta.get(reaction)
    console.log(`  Yes! ${pub.id} 🔗 ${meta.id}`)
    if (meta.readPubs.has(reaction)) {
      throw `Reaction, ${meta.id}, is trying to sub to ${k} that was read previously; pick one to be consistent`
    }
    // Add after checking to be idempotent
    meta.subPubs.add(pub)
    pub.subscribers.add(reaction)
  } else {
    console.log(`  No, ${caller.name} is not the active reaction`)
  }
  sAllowRead = true
  const valueToFwd = pub()
  sAllowRead = false
  return valueToFwd
}

function createPub(value, name) {
  const pub = (...args) => {
    if (args.length) {
      const [valueNext] = args
      console.log(`SET ${pub.id}:`, pub.value, '➡', valueNext, `Notifying ${pub.subscribers.size} reactions`)
      pub.value = valueNext
      pub.subscribers.forEach(runReaction)
      // Don't return a value. Keeps it simple if SET doesn't also READ
      return;
    }
    if (reaction) {
      const meta = reactionMeta.get(reaction)
      console.log(`READ ${pub.id} with active reaction ${meta.id}`)
      if (sAllowRead === false && meta.subPubs.has(pub)) {
        throw `Reaction, ${meta.id}, is trying to read ${pub.id} that was subbed previously; pick one to be consistent`
      }
      // Add after checking to be idempotent
      meta.readPubs.add(pub)
    } else {
      console.log(`READ ${pub.id} with no active reaction`)
    }
    return pub.value
  }
  pub.id = `P${pubId++}` + name ? ` ${name}` : '';
  pub.value = value
  pub.subscribers = new Set();
  return pub
}

function createPubBundle(bundle) {
  for (const [k,v] of Object.entries(bundle)) {
    bundle[k] = createPub(v, k);
  }
  return bundle
}

const data = createPubBundle({
  label: 'Default',
  count: 10,
  countMax: 100,
  list: ['Hi!'],
  wsMessages: [],
})

data.label('Something nice')
console.log('Read from label:', data.label())
console.log('Read from wsMessages:', data.wsMessages())

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
  const badCount = s(data.count) * 10 + data.countMax()
  const count = data.count() * 10 + data.countMax()
  return count
}

// Another case to check... If I s(data.count) outside, and then call DoSomeWork
// which does a read data.count() then does that throw the error about
// consistency issues? Then what about s(DoSomeWork) case? Maybe s(Fn, [pub])

DoSomeWork() // Error as s(data.count); OK as data.count()
createReaction(DoSomeWork) // Works as s(data.count); Useless as data.count()

createReaction(() => s(DoSomeWork)) // If s(data.count) ... hmm. I think throw. No nests!
createReaction(() => s(DoSomeWork, [data.count]))
createReaction(() => s(DoSomeWork, [data.count, data.countMax])) // === s(DoSomeWork)

data.count(data.count() + 1)

createReaction(() => {
  console.log('This one is interested in data.list, so it will sub to that')
  console.log(data.list().reduce((acc, now) => acc + String(now), ''))
  console.log('Then I\'ll try to do some work')
  // Safe
  const safeCount = DoSomeWork()
  // Opt-in subscribe version
  const count = s(DoSomeWork)
})
