/* eslint-disable no-unused-vars */
import { createNamedBoxes, createReaction, s, sFrom, sIgnore } from '../src/sGlobal.js';

const data = createNamedBoxes({
  label: 'Default',
  count: 10,
  countMax: 100,
  list: ['Hi!'],
  wsMessages: [],
});

data.label('Something nice');
console.log('Get label:', data.label());
console.log('Get wsMessages:', data.wsMessages());

function addLog(msg) {
  data.wsMessages(data.wsMessages().concat(msg));
}

let logWrites = 0;
createReaction(function WriteLog() {
  console.log(`Here's the new log! WriteLog#${++logWrites}: ${s(data.wsMessages).length} items\n  - ${s(data.wsMessages).join('\n  - ')}`);
});

createReaction(function DoComputation() {
  addLog(`DoComputation is updating: ${data.count()}`);
  console.log(data.count() + data.list()[0] + s(data.label));
});

addLog('I can update the log and it calls WriteLog but leaves DoComp alone');
data.label('Writing a new label calls DoComp which then also calls WriteLog');

// Ok! Let's talk about nesting subscriptions and how to be informed and safe
// when calling functions from within your reactions

function DoSomeWork() {
  console.log('Trying to read from data.count');
  // This line makes this function a bit different. It's an s(...) outside of a
  // createReaction call, so DoSomeWork() throws an error. You have to either
  // pass this _directly_ into a createReaction or use sIgnore() or sFrom()
  const countA = s(data.count) * 10 + data.countMax();
  // Note that if the line was written without s(...) there's no issue. Then
  // this is just a normal function
  const countB = data.count() * 10 + data.countMax();
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
  DoSomeWork(); // Error as s(data.count); OK as data.count()
} catch (err) {
  console.log('Thrown', err.message);
}
try {
  sFrom(DoSomeWork); // Error since the resulting subscriptions have no reactions
} catch (err) {
  console.log('Thrown', err.message);
}
try {
  sIgnore(DoSomeWork); // OK. Error is due to consistency check failing in DoWork
} catch (err) {
  console.log('Thrown', err.message);
}
try {
  // Works as s(data.count); Useless as data.count()
  // Error for consistency check again
  createReaction(DoSomeWork);
} catch (err) {
  console.log('Thrown', err.message);
}

function DoSomeWorkFixed() {
  return s(data.count) * 10 + data.countMax();
}

createReaction(() => {
  const el = String(700 * sFrom(DoSomeWorkFixed) + '%');
  console.log('Reaction for DoSomeWorkFixed:', el);
});

data.count(data.count() + 1);

createReaction(() => {
  console.log('This one is interested in data.list, so it will sub to that');
  console.log(data.list().reduce((acc, now) => acc + String(now), ''));
  console.log('Then I\'ll try to do some work');

  // Safe: Any inner subscriptions will throw an error to make sure the dev is
  // informed when deciding how to proceed
  try {
    const countA = DoSomeWorkFixed();
  } catch (err) {
    console.log('CountA Thrown', err.message);
  }

  // Opt-out version: Doesn't throw for inner subscriptions; ignores s()/sFrom()
  // calls deeper in the tree
  try {
    const countB = sIgnore(DoSomeWorkFixed);
  } catch (err) {
    console.log('CountB Thrown', err.message);
  }

  // Opt-in version: Doesn't throw for inner subscriptions; s()/sFrom() calls
  // are subscribed to unless an sIgnore() is reached
  try {
    const countC = sFrom(DoSomeWorkFixed);
  } catch (err) {
    console.log('CountC Thrown', err.message);
  }
});
